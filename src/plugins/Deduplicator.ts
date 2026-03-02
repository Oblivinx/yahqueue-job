import type { IPlugin } from '../types/plugin.types.js';
import type { Job, JobPayload, JobResult } from '../types/job.types.js';
import { QueueError } from '../errors/QueueError.js';

/**
 * Deduplicator plugin — prevents duplicate job IDs from entering the queue.
 * Removes the ID from the set after job completes (allows re-enqueue).
 */
export class Deduplicator implements IPlugin {
    readonly name = 'Deduplicator';
    private readonly active = new Set<string>();

    onEnqueue<T extends JobPayload>(job: Job<T>): void {
        if (this.active.has(job.id)) {
            throw new QueueError(`Duplicate job ID: "${job.id}" is already in the queue`);
        }
        this.active.add(job.id);
    }

    onComplete<T extends JobPayload>(job: Job<T>, _result: JobResult): void {
        this.active.delete(job.id);
    }

    onFail<T extends JobPayload>(job: Job<T>, _error: Error): void {
        this.active.delete(job.id);
    }

    onExpire<T extends JobPayload>(job: Job<T>): void {
        this.active.delete(job.id);
    }

    /** Return the current number of tracked active jobs */
    get size(): number {
        return this.active.size;
    }
}
