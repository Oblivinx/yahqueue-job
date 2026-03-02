import type { Job, JobPayload } from '../types/job.types.js';
import type { IStorageAdapter } from '../types/adapter.types.js';
export interface SnapshotData {
    seq: number;
    timestamp: number;
    jobs: Job<JobPayload>[];
}
/**
 * Snapshot — periodic full state persistence.
 * Uses atomic rename (write to .tmp then rename) for crash-safety.
 */
export declare class Snapshot {
    private readonly snapshotPath;
    private readonly adapter;
    private timerId?;
    private lastSeq;
    constructor(snapshotPath: string, adapter: IStorageAdapter);
    /**
     * Write a snapshot immediately.
     * @param seq - The WAL sequence number at the time of snapshot
     */
    write(seq: number): Promise<void>;
    /**
     * Read the latest snapshot from disk.
     * Returns null if no snapshot exists.
     */
    read(): SnapshotData | null;
    /**
     * Start periodic snapshot schedule.
     */
    schedule(intervalMs: number, getSeq: () => number): void;
    /** Stop the periodic snapshot timer */
    stop(): void;
    get lastSnapshotSeq(): number;
}
