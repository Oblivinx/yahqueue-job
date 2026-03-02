"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobQueue = void 0;
const events_1 = require("events");
const MemoryAdapter_js_1 = require("../adapters/MemoryAdapter.js");
const errors_js_1 = require("./errors.js");
const JobBuilder_js_1 = require("./JobBuilder.js");
class JobQueue extends events_1.EventEmitter {
    adapter;
    isProcessing = false;
    workers = new Set();
    concurrency;
    isClosed = false;
    constructor(options, adapter) {
        super();
        this.concurrency = options.concurrency || 1;
        this.adapter = adapter || new MemoryAdapter_js_1.MemoryAdapter();
    }
    /**
     * Enqueue a new job
     * @param options - Job configuration options
     * @returns The created Job
     */
    async enqueue(options) {
        this.checkClosed();
        try {
            const job = new JobBuilder_js_1.JobBuilder().fromOptions(options).build();
            await this.adapter.push(job);
            this.emit('enqueued', job);
            this.triggerProcessing();
            return job;
        }
        catch (error) {
            if (error instanceof errors_js_1.JobQueueError)
                throw error;
            const err = new errors_js_1.AdapterError('Failed to enqueue job', error);
            this.emit('error', err);
            throw err;
        }
    }
    /**
     * Start processing the queue automatically
     */
    start() {
        this.checkClosed();
        if (this.isProcessing)
            return;
        this.isProcessing = true;
        this.triggerProcessing();
    }
    /**
     * Stop processing the queue
     */
    pause() {
        this.isProcessing = false;
    }
    /**
     * Get the current sizing of the queue (pending jobs)
     */
    async size() {
        return this.adapter.size();
    }
    /**
     * Clear all jobs
     */
    async clear() {
        await this.adapter.clear();
    }
    /**
     * Close the adapter and reject new jobs
     */
    async close() {
        this.isClosed = true;
        this.isProcessing = false;
        await Promise.all(this.workers);
        await this.adapter.close();
    }
    checkClosed() {
        if (this.isClosed) {
            throw new errors_js_1.JobQueueError('JobQueue is closed');
        }
    }
    triggerProcessing() {
        if (!this.isProcessing || this.isClosed)
            return;
        // Fill up workers to concurrency limit
        while (this.workers.size < this.concurrency) {
            const workerPromise = this.processNextJob()
                .catch(err => { this.emit('error', err); return false; })
                .then((didProcess) => {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                this.workers.delete(workerPromise);
                if (this.isProcessing && !this.isClosed && didProcess) {
                    this.triggerProcessing();
                }
            });
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            this.workers.add(workerPromise);
        }
    }
    async processNextJob() {
        if (this.isClosed)
            return false;
        let job = null;
        try {
            job = await this.adapter.pop();
        }
        catch (error) {
            throw new errors_js_1.AdapterError('Failed to pop job', error);
        }
        if (!job)
            return false;
        job.status = 'active';
        job.startedAt = Date.now();
        job.attempts++;
        try {
            await this.adapter.update(job);
            this.emit('active', job);
            // Timeout wrapper logic
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new errors_js_1.JobTimeoutError(job.id, job.timeout)), job.timeout);
            });
            // Handler promise
            const handlerPromise = new Promise((resolve, reject) => {
                // Find if listeners exist
                if (this.listenerCount('process') === 0) {
                    return reject(new errors_js_1.JobQueueError(`No processor attached to process job`));
                }
                // Wait for user processor
                // Note: Using event emitter pattern for processor means we have to capture the result
                // For standard task execution, usually an async handler function is passed instead.
                // But since we use events, let's emit and wait for completion.
                // Alternatively, since tests need 100% and timing: 
                // We'll run the process event synchronously and await it.
                // Actually, many popular queues use process(handler) method.
                // Let's implement queue.process(handler) pattern but standard EventEmitter might be simpler:
                // we'll just emit 'process' and expect listeners to be synchronus or throw.
                // Wait, normally we want an async function.
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
        }
        catch (error) {
            // Failed
            job.error = error instanceof Error ? error.message : String(error);
            if (job.attempts < job.maxRetries) {
                // Retry logic: set status back to pending, possibly add delay
                job.status = 'pending';
                // Simple backoff: delay = attempt * 1000
                job.runAt = Date.now() + (job.attempts * 1000);
                await this.adapter.update(job);
                this.emit('failed', job, error);
            }
            else {
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
    _processor;
    /**
     * Register a processor function for the queue
     */
    process(handler) {
        this._processor = handler;
        this.start();
    }
    async runHandler(job) {
        if (!this._processor) {
            throw new errors_js_1.JobQueueError('No processor registered');
        }
        await this._processor(job);
    }
}
exports.JobQueue = JobQueue;
