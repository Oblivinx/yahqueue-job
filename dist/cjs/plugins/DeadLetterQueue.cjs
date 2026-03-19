"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeadLetterQueue = void 0;
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
class DeadLetterQueue {
    name = 'DeadLetterQueue';
    entries = new Map();
    enqueueCallback;
    // feat: WAL reference for persisting DLQ entries across restarts
    wal = null;
    /** Called by JobQueue to wire up re-enqueue capability */
    setEnqueueCallback(cb) {
        this.enqueueCallback = cb;
    }
    // feat: called by JobQueue to wire up WAL persistence
    setWAL(wal) {
        this.wal = wal;
    }
    onFail(job, error) {
        const capturedAt = Date.now();
        this.entries.set(job.id, {
            job: job,
            error,
            capturedAt,
        });
        // feat: persist DLQ entry so it survives crashes
        this.wal?.append('DLQ_ADD', job.id, {
            job: job,
            errorMessage: error.message,
            errorName: error.name,
            capturedAt,
        });
    }
    onComplete(job, _result) {
        // If job was retried from DLQ and now succeeded, remove from DLQ
        if (this.entries.has(job.id)) {
            this.entries.delete(job.id);
            // feat: persist DLQ removal on retry success
            this.wal?.append('DLQ_REMOVE', job.id);
        }
    }
    /** Return all DLQ entries */
    list() {
        return Array.from(this.entries.values());
    }
    /** Get a specific DLQ entry */
    get(jobId) {
        return this.entries.get(jobId);
    }
    /** Number of jobs in DLQ */
    get size() {
        return this.entries.size;
    }
    /**
     * Re-enqueue a job from the DLQ with reset attempts.
     * @throws Error if jobId not found in DLQ
     */
    async retry(jobId) {
        const entry = this.entries.get(jobId);
        if (!entry)
            throw new Error(`Job "${jobId}" not found in Dead Letter Queue`);
        if (!this.enqueueCallback)
            throw new Error('DLQ not connected to queue (no enqueue callback)');
        this.entries.delete(jobId);
        // feat: persist DLQ removal on retry
        this.wal?.append('DLQ_REMOVE', jobId);
        const resetJob = { ...entry.job, attempts: 0, state: 'pending' };
        await this.enqueueCallback(resetJob);
    }
    /** Retry all jobs currently in the DLQ */
    async retryAll() {
        const ids = Array.from(this.entries.keys());
        for (const id of ids) {
            await this.retry(id);
        }
    }
    /**
     * Remove DLQ entries older than the given timestamp (ms since epoch).
     * @param olderThan - Entries captured before this time are removed
     */
    purge(olderThan) {
        let removed = 0;
        for (const [id, entry] of this.entries) {
            if (entry.capturedAt < olderThan) {
                this.entries.delete(id);
                // feat: persist purge removals
                this.wal?.append('DLQ_REMOVE', id);
                removed++;
            }
        }
        return removed;
    }
    /**
     * Restore DLQ entries from WAL replay after crash recovery.
     * Call this after Recovery.run() during queue initialization.
     */
    // feat: WAL replay to rebuild entries map after process restart
    restoreFromWAL(entries) {
        for (const entry of entries) {
            if (entry.op === 'DLQ_ADD') {
                const data = entry.data;
                if (data?.job) {
                    // fix: reconstruct Error object from serialized name+message
                    const error = Object.assign(new Error(data.errorMessage ?? ''), {
                        name: data.errorName ?? 'Error',
                    });
                    this.entries.set(entry.jobId, {
                        job: data.job,
                        error,
                        capturedAt: data.capturedAt ?? Date.now(),
                    });
                }
            }
            else if (entry.op === 'DLQ_REMOVE') {
                this.entries.delete(entry.jobId);
            }
        }
    }
}
exports.DeadLetterQueue = DeadLetterQueue;
