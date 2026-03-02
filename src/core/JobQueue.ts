import { EventEmitter } from 'events';
import { IStorageAdapter } from '../adapters/IStorageAdapter.js';
import { MemoryAdapter } from '../adapters/MemoryAdapter.js';
import { JobQueueError, AdapterError, JobTimeoutError } from './errors.js';
import { Job, JobOptions, QueueOptions, JobStatus } from './types.js';
import { JobBuilder } from './JobBuilder.js';

export class JobQueue<T = unknown> extends EventEmitter {
    private adapter: IStorageAdapter;
    private isProcessing: boolean = false;
    private workers: Set<Promise<boolean>> = new Set();
    private concurrency: number;
    private isClosed: boolean = false;

    constructor(options: QueueOptions, adapter?: IStorageAdapter) {
        super();
        this.concurrency = options.concurrency || 1;
        this.adapter = adapter || new MemoryAdapter();
    }

    /**
     * Enqueue a new job
     * @param options - Job configuration options
     * @returns The created Job
     */
    async enqueue(options: JobOptions<T>): Promise<Job<T>> {
        this.checkClosed();
        try {
            const job = new JobBuilder<T>().fromOptions(options).build();
            await this.adapter.push(job);
            this.emit('enqueued', job);
            this.triggerProcessing();
            return job;
        } catch (error) {
            if (error instanceof JobQueueError) throw error;
            const err = new AdapterError('Failed to enqueue job', error);
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * Start processing the queue automatically
     */
    start(): void {
        this.checkClosed();
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.triggerProcessing();
    }

    /**
     * Stop processing the queue
     */
    pause(): void {
        this.isProcessing = false;
    }

    /**
     * Get the current sizing of the queue (pending jobs)
     */
    async size(): Promise<number> {
        return this.adapter.size();
    }

    /**
     * Clear all jobs
     */
    async clear(): Promise<void> {
        await this.adapter.clear();
    }

    /**
     * Close the adapter and reject new jobs
     */
    async close(): Promise<void> {
        this.isClosed = true;
        this.isProcessing = false;
        await Promise.all(this.workers);
        await this.adapter.close();
    }

    private checkClosed() {
        if (this.isClosed) {
            throw new JobQueueError('JobQueue is closed');
        }
    }

    private triggerProcessing(): void {
        if (!this.isProcessing || this.isClosed) return;

        // Fill up workers to concurrency limit
        while (this.workers.size < this.concurrency) {
            const workerPromise = this.processNextJob();
            this.workers.add(workerPromise);

            workerPromise
                .then((didProcess) => {
                    this.workers.delete(workerPromise);
                    if (this.isProcessing && !this.isClosed) {
                        if (didProcess) {
                            this.triggerProcessing();
                        } else {
                            // Check if jobs were enqueued while we were going idle
                            this.adapter.size().then(size => {
                                if (size > 0) this.triggerProcessing();
                            }).catch(() => { });
                        }
                    }
                })
                .catch(err => {
                    this.workers.delete(workerPromise);
                    this.emit('error', err);
                });
        }
    }

    private async processNextJob(): Promise<boolean> {
        if (this.isClosed) return false;

        let job: Job<T> | null = null;
        try {
            job = await this.adapter.pop<T>();
        } catch (error) {
            throw new AdapterError('Failed to pop job', error);
        }

        if (!job) return false;

        job.status = 'active';
        job.startedAt = Date.now();
        job.attempts++;

        try {
            await this.adapter.update(job);
            this.emit('active', job);

            // Timeout wrapper logic
            let timeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new JobTimeoutError(job!.id, job!.timeout)), job!.timeout);
            });

            // Wait for process or timeout
            await Promise.race([
                this.runHandler(job),
                timeoutPromise
            ]).finally(() => clearTimeout(timeoutId));

            // Success
            job.status = 'completed';
            job.finishedAt = Date.now();
            await this.adapter.update(job);
            this.emit('completed', job);

        } catch (error) {
            // Failed
            job.error = error instanceof Error ? error.message : String(error);

            if (job.attempts < job.maxRetries) {
                // Retry logic: set status back to pending, possibly add delay
                job.status = 'pending';
                // Simple backoff: delay = attempt * 1000
                job.runAt = Date.now() + (job.attempts * 1000);
                await this.adapter.update(job);
                this.emit('failed', job, error);
            } else {
                // Ultimate failure
                job.status = 'failed';
                job.finishedAt = Date.now();
                await this.adapter.update(job);
                this.emit('failed', job, error);
            }
        }

        return true;
    }

    // A registry for the processor function
    private _processor?: (job: Job<T>) => Promise<void>;

    /**
     * Register a processor function for the queue
     */
    process(handler: (job: Job<T>) => Promise<void>): void {
        this._processor = handler;
        this.start();
    }

    private async runHandler(job: Job<T>): Promise<void> {
        if (!this._processor) {
            throw new JobQueueError('No processor registered');
        }
        await this._processor(job);
    }
}
