import * as fs from 'fs';
import * as path from 'path';
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
export class Snapshot {
    private readonly snapshotPath: string;
    private readonly adapter: IStorageAdapter;
    private timerId?: ReturnType<typeof setInterval>;
    private lastSeq = -1;

    constructor(snapshotPath: string, adapter: IStorageAdapter) {
        this.snapshotPath = snapshotPath;
        this.adapter = adapter;
    }

    /**
     * Write a snapshot immediately.
     * @param seq - The WAL sequence number at the time of snapshot
     */
    async write(seq: number): Promise<void> {
        const jobs = await this.adapter.getAll();
        const data: SnapshotData = { seq, timestamp: Date.now(), jobs };
        const dir = path.dirname(this.snapshotPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = `${this.snapshotPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, this.snapshotPath);
        this.lastSeq = seq;
    }

    /**
     * Read the latest snapshot from disk.
     * Returns null if no snapshot exists.
     */
    read(): SnapshotData | null {
        if (!fs.existsSync(this.snapshotPath)) return null;
        try {
            const raw = fs.readFileSync(this.snapshotPath, 'utf8');
            return JSON.parse(raw) as SnapshotData;
        } catch {
            return null;
        }
    }

    /**
     * Start periodic snapshot schedule.
     */
    schedule(intervalMs: number, getSeq: () => number): void {
        if (this.timerId !== undefined) return;
        this.timerId = setInterval(() => {
            this.write(getSeq()).catch(() => { /* silent — WAL still covers it */ });
        }, intervalMs);
    }

    /** Stop the periodic snapshot timer */
    stop(): void {
        if (this.timerId !== undefined) {
            clearInterval(this.timerId);
            this.timerId = undefined;
        }
    }

    get lastSnapshotSeq(): number {
        return this.lastSeq;
    }
}
