import * as fs from 'fs';
import * as path from 'path';

export type WALOperation =
    | 'ENQUEUE'
    | 'ACTIVATE'
    | 'COMPLETE'
    | 'FAIL'
    | 'RETRY'
    | 'EXPIRE'
    | 'DLQ';

export interface WALEntry {
    seq: number;
    op: WALOperation;
    jobId: string;
    timestamp: number;
    data?: unknown;
}

/**
 * WALWriter — Write-Ahead Log for crash recovery.
 * Each operation is appended as a JSON line (synchronous for atomicity).
 */
export class WALWriter {
    private readonly walPath: string;
    private seq = 0;
    private enabled: boolean;

    constructor(walPath: string, enabled = true) {
        this.walPath = walPath;
        this.enabled = enabled;
    }

    /**
     * Initialize: ensure directory exists & read current sequence number.
     */
    initialize(): void {
        if (!this.enabled) return;
        const dir = path.dirname(this.walPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(this.walPath)) {
            const lines = fs.readFileSync(this.walPath, 'utf8').split('\n').filter(Boolean);
            const last = lines[lines.length - 1];
            if (last) {
                try {
                    const entry = JSON.parse(last) as WALEntry;
                    this.seq = entry.seq + 1;
                } catch {
                    /* malformed last line — safe to ignore */
                }
            }
        }
    }

    /**
     * Append a WAL entry synchronously.
     */
    append(op: WALOperation, jobId: string, data?: unknown): WALEntry {
        const entry: WALEntry = {
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
    readAll(): WALEntry[] {
        if (!this.enabled || !fs.existsSync(this.walPath)) return [];
        const lines = fs.readFileSync(this.walPath, 'utf8').split('\n').filter(Boolean);
        return lines.map((line) => JSON.parse(line) as WALEntry);
    }

    /**
     * Read WAL entries after a given sequence number (for post-snapshot replay).
     */
    readAfter(seq: number): WALEntry[] {
        return this.readAll().filter((e) => e.seq > seq);
    }

    /**
     * Truncate the WAL (called after snapshot is persisted).
     */
    truncate(): void {
        if (!this.enabled) return;
        fs.writeFileSync(this.walPath, '', 'utf8');
        this.seq = 0;
    }

    get currentSeq(): number {
        return this.seq;
    }
}
