import * as fs from 'fs';
import * as path from 'path';
/**
 * Snapshot — periodic full state persistence.
 * Uses atomic rename (write to .tmp then rename) for crash-safety.
 */
export class Snapshot {
    snapshotPath;
    adapter;
    timerId;
    lastSeq = -1;
    constructor(snapshotPath, adapter) {
        this.snapshotPath = snapshotPath;
        this.adapter = adapter;
    }
    /**
     * Write a snapshot immediately.
     * @param seq - The WAL sequence number at the time of snapshot
     */
    async write(seq) {
        const jobs = await this.adapter.getAll();
        const data = { seq, timestamp: Date.now(), jobs };
        const dir = path.dirname(this.snapshotPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const tmp = `${this.snapshotPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, this.snapshotPath);
        this.lastSeq = seq;
    }
    /**
     * Read the latest snapshot from disk.
     * Returns null if no snapshot exists.
     */
    read() {
        if (!fs.existsSync(this.snapshotPath))
            return null;
        try {
            const raw = fs.readFileSync(this.snapshotPath, 'utf8');
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    /**
     * Start periodic snapshot schedule.
     */
    schedule(intervalMs, getSeq) {
        if (this.timerId !== undefined)
            return;
        this.timerId = setInterval(() => {
            this.write(getSeq()).catch(() => { });
        }, intervalMs);
    }
    /** Stop the periodic snapshot timer */
    stop() {
        if (this.timerId !== undefined) {
            clearInterval(this.timerId);
            this.timerId = undefined;
        }
    }
    get lastSnapshotSeq() {
        return this.lastSeq;
    }
}
