import type { IPlugin } from '../types/plugin.types.js';
import type { Job, JobPayload, JobResult } from '../types/job.types.js';
import type { WALWriter, WALEntry } from '../persistence/WALWriter.js';
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
export declare class DeadLetterQueue implements IPlugin {
    readonly name = "DeadLetterQueue";
    private readonly entries;
    private enqueueCallback?;
    private wal;
    /** Called by JobQueue to wire up re-enqueue capability */
    setEnqueueCallback(cb: (job: Job<JobPayload>) => Promise<void>): void;
    setWAL(wal: WALWriter): void;
    onFail<T extends JobPayload>(job: Job<T>, error: Error): void;
    onComplete<T extends JobPayload>(job: Job<T>, _result: JobResult): void;
    /** Return all DLQ entries */
    list(): DLQEntry[];
    /** Get a specific DLQ entry */
    get(jobId: string): DLQEntry | undefined;
    /** Number of jobs in DLQ */
    get size(): number;
    /**
     * Re-enqueue a job from the DLQ with reset attempts.
     * @throws Error if jobId not found in DLQ
     */
    retry(jobId: string): Promise<void>;
    /** Retry all jobs currently in the DLQ */
    retryAll(): Promise<void>;
    /**
     * Remove DLQ entries older than the given timestamp (ms since epoch).
     * @param olderThan - Entries captured before this time are removed
     */
    purge(olderThan: number): number;
    /**
     * Restore DLQ entries from WAL replay after crash recovery.
     * Call this after Recovery.run() during queue initialization.
     */
    restoreFromWAL(entries: WALEntry[]): void;
}
