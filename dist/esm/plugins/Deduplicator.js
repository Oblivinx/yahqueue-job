import { QueueError } from '../errors/QueueError.js';
/**
 * Deduplicator plugin — prevents duplicate job IDs from entering the queue.
 * Removes the ID from the set after job completes (allows re-enqueue).
 */
export class Deduplicator {
    name = 'Deduplicator';
    active = new Set();
    onEnqueue(job) {
        if (this.active.has(job.id)) {
            throw new QueueError(`Duplicate job ID: "${job.id}" is already in the queue`);
        }
        this.active.add(job.id);
    }
    onComplete(job, _result) {
        this.active.delete(job.id);
    }
    onFail(job, _error) {
        this.active.delete(job.id);
    }
    onExpire(job) {
        this.active.delete(job.id);
    }
    /** Return the current number of tracked active jobs */
    get size() {
        return this.active.size;
    }
}
