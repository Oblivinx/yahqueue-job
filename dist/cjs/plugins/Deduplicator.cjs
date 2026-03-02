"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Deduplicator = void 0;
const QueueError_js_1 = require("../errors/QueueError.cjs");
/**
 * Deduplicator plugin — prevents duplicate job IDs from entering the queue.
 * Removes the ID from the set after job completes (allows re-enqueue).
 */
class Deduplicator {
    name = 'Deduplicator';
    active = new Set();
    onEnqueue(job) {
        if (this.active.has(job.id)) {
            throw new QueueError_js_1.QueueError(`Duplicate job ID: "${job.id}" is already in the queue`);
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
exports.Deduplicator = Deduplicator;
