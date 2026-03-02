import type { IPlugin } from '../types/plugin.types.js';
import type { Job, JobPayload, JobResult } from '../types/job.types.js';

export interface DLQEntry {
    job: Job<JobPayload>;
    error: Error;
    capturedAt: number;
}

/**
 * DeadLetterQueue plugin — captures permanently failed jobs.
 * Provides inspect/retry/purge API.
 *
 * @example
 * const dlq = new DeadLetterQueue();
 * queue.on('dead-letter', ({ job, error }) => console.log(job.id, error));
 * queue.dlq.list()           // all DLQ entries
 * queue.dlq.retry(jobId)     // re-enqueue a job from DLQ
 */
export class DeadLetterQueue implements IPlugin {
    readonly name = 'DeadLetterQueue';
    private readonly entries = new Map<string, DLQEntry>();
    private enqueueCallback?: (job: Job<JobPayload>) => Promise<void>;

    /** Called by JobQueue to wire up re-enqueue capability */
    setEnqueueCallback(cb: (job: Job<JobPayload>) => Promise<void>): void {
        this.enqueueCallback = cb;
    }

    onFail<T extends JobPayload>(job: Job<T>, error: Error): void {
        this.entries.set(job.id, {
            job: job as Job<JobPayload>,
            error,
            capturedAt: Date.now(),
        });
    }

    onComplete<T extends JobPayload>(job: Job<T>, _result: JobResult): void {
        // If job was retried from DLQ and now succeeded, remove from DLQ
        this.entries.delete(job.id);
    }

    /** Return all DLQ entries */
    list(): DLQEntry[] {
        return Array.from(this.entries.values());
    }

    /** Get a specific DLQ entry */
    get(jobId: string): DLQEntry | undefined {
        return this.entries.get(jobId);
    }

    /** Number of jobs in DLQ */
    get size(): number {
        return this.entries.size;
    }

    /**
     * Re-enqueue a job from the DLQ with reset attempts.
     * @throws Error if jobId not found in DLQ
     */
    async retry(jobId: string): Promise<void> {
        const entry = this.entries.get(jobId);
        if (!entry) throw new Error(`Job "${jobId}" not found in Dead Letter Queue`);
        if (!this.enqueueCallback) throw new Error('DLQ not connected to queue (no enqueue callback)');
        this.entries.delete(jobId);
        const resetJob = { ...entry.job, attempts: 0, state: 'pending' as const };
        await this.enqueueCallback(resetJob as Job<JobPayload>);
    }

    /** Retry all jobs currently in the DLQ */
    async retryAll(): Promise<void> {
        const ids = Array.from(this.entries.keys());
        for (const id of ids) {
            await this.retry(id);
        }
    }

    /**
     * Remove DLQ entries older than the given timestamp (ms since epoch).
     * @param olderThan - Entries captured before this time are removed
     */
    purge(olderThan: number): number {
        let removed = 0;
        for (const [id, entry] of this.entries) {
            if (entry.capturedAt < olderThan) {
                this.entries.delete(id);
                removed++;
            }
        }
        return removed;
    }
}
