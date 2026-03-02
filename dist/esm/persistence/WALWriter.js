import * as fs from 'fs';
import * as path from 'path';
/**
 * WALWriter — Write-Ahead Log for crash recovery.
 * Each operation is appended as a JSON line (synchronous for atomicity).
 */
export class WALWriter {
    walPath;
    seq = 0;
    enabled;
    constructor(walPath, enabled = true) {
        this.walPath = walPath;
        this.enabled = enabled;
    }
    /**
     * Initialize: ensure directory exists & read current sequence number.
     */
    initialize() {
        if (!this.enabled)
            return;
        const dir = path.dirname(this.walPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(this.walPath)) {
            const lines = fs.readFileSync(this.walPath, 'utf8').split('\n').filter(Boolean);
            const last = lines[lines.length - 1];
            if (last) {
                try {
                    const entry = JSON.parse(last);
                    this.seq = entry.seq + 1;
                }
                catch {
                    /* malformed last line — safe to ignore */
                }
            }
        }
    }
    /**
     * Append a WAL entry synchronously.
     */
    append(op, jobId, data) {
        const entry = {
            seq: this.seq++,
            op,
            jobId,
            timestamp: Date.now(),
            data,
        };
        if (this.enabled) {
            fs.appendFileSync(this.walPath, JSON.stringify(entry) + '\n', 'utf8');
        }
        return entry;
    }
    /**
     * Read all WAL entries from disk.
     */
    readAll() {
        if (!this.enabled || !fs.existsSync(this.walPath))
            return [];
        const lines = fs.readFileSync(this.walPath, 'utf8').split('\n').filter(Boolean);
        return lines.map((line) => JSON.parse(line));
    }
    /**
     * Read WAL entries after a given sequence number (for post-snapshot replay).
     */
    readAfter(seq) {
        return this.readAll().filter((e) => e.seq > seq);
    }
    /**
     * Truncate the WAL (called after snapshot is persisted).
     */
    truncate() {
        if (!this.enabled)
            return;
        fs.writeFileSync(this.walPath, '', 'utf8');
        this.seq = 0;
    }
    get currentSeq() {
        return this.seq;
    }
}
