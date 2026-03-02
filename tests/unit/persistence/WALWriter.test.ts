import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WALWriter } from '../../../src/persistence/WALWriter.js';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-wal-test-'));
}

describe('WALWriter', () => {
    let tmpDir: string;
    let walPath: string;

    beforeEach(() => {
        vi.useRealTimers();
        tmpDir = makeTempDir();
        walPath = path.join(tmpDir, 'test.wal');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('appends entries and reads them back', () => {
        const wal = new WALWriter(walPath);
        wal.initialize();
        wal.append('ENQUEUE', 'job-1', { foo: 'bar' });
        wal.append('ACTIVATE', 'job-1');
        const entries = wal.readAll();
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({ op: 'ENQUEUE', jobId: 'job-1' });
        expect(entries[1]).toMatchObject({ op: 'ACTIVATE', jobId: 'job-1' });
    });

    it('readAfter returns only entries with seq > given value', () => {
        const wal = new WALWriter(walPath);
        wal.initialize();
        wal.append('ENQUEUE', 'a');
        wal.append('ENQUEUE', 'b');
        wal.append('ENQUEUE', 'c');
        const entries = wal.readAfter(0);
        expect(entries).toHaveLength(2); // seq 1 and seq 2
        expect(entries[0]!.jobId).toBe('b');
    });

    it('truncate clears the WAL and resets seq', () => {
        const wal = new WALWriter(walPath);
        wal.initialize();
        wal.append('ENQUEUE', 'a');
        wal.truncate();
        expect(wal.readAll()).toHaveLength(0);
        expect(wal.currentSeq).toBe(0);
    });

    it('resumes seq from existing WAL on initialize', () => {
        const wal1 = new WALWriter(walPath);
        wal1.initialize();
        wal1.append('ENQUEUE', 'x');
        wal1.append('ENQUEUE', 'y');

        const wal2 = new WALWriter(walPath);
        wal2.initialize();
        expect(wal2.currentSeq).toBe(2);
    });

    it('noop when disabled', () => {
        const wal = new WALWriter(walPath, false);
        wal.initialize();
        wal.append('ENQUEUE', 'a');
        wal.truncate();
        expect(wal.readAll()).toHaveLength(0);
        expect(fs.existsSync(walPath)).toBe(false);
    });

    it('returns empty array when file does not exist', () => {
        const wal = new WALWriter(path.join(tmpDir, 'nonexistent.wal'));
        wal.initialize();
        expect(wal.readAll()).toHaveLength(0);
    });
});
