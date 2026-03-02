import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JobQueue } from '../../src/core/JobQueue.js';
import { FileAdapter } from '../../src/adapters/FileAdapter.js';
import { WALWriter } from '../../src/persistence/WALWriter.js';
import { Snapshot } from '../../src/persistence/Snapshot.js';
import { Recovery } from '../../src/persistence/Recovery.js';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter.js';
import { createJob } from '../../src/job/Job.js';
import { JobState } from '../../src/job/JobState.js';
import { updateJob } from '../../src/job/Job.js';

describe('Crash Recovery Integration', () => {
    let tmpDir: string;
    let walPath: string;
    let snapshotPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-recovery-'));
        walPath = path.join(tmpDir, 'test.wal');
        snapshotPath = path.join(tmpDir, 'snapshot.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('replays ENQUEUE from WAL on restart', async () => {
        const adapter = new MemoryAdapter();
        const wal = new WALWriter(walPath);
        wal.initialize();
        const job = createJob(
            { type: 'test', payload: {} },
            { defaultPriority: 5, defaultMaxAttempts: 3, defaultMaxDuration: 30_000 },
        );
        wal.append('ENQUEUE', job.id, job);

        const snap = new Snapshot(snapshotPath, adapter);
        const recovery = new Recovery(wal, snap, adapter);
        await recovery.run();

        const restored = await adapter.get(job.id);
        expect(restored?.id).toBe(job.id);
    });

    it('resets ACTIVE jobs to PENDING after restart', async () => {
        const adapter = new MemoryAdapter();
        const wal = new WALWriter(walPath);
        wal.initialize();
        const job = createJob(
            { type: 'test', payload: {} },
            { defaultPriority: 5, defaultMaxAttempts: 3, defaultMaxDuration: 30_000 },
        );
        // Simulate: job was enqueued and activated, but crashed before completion
        wal.append('ENQUEUE', job.id, job);
        const activeJob = updateJob(job, { state: JobState.ACTIVE });
        wal.append('ACTIVATE', activeJob.id);
        await adapter.push(job);
        await adapter.update(activeJob);

        const snap = new Snapshot(snapshotPath, adapter);
        const recovery = new Recovery(wal, snap, adapter);
        await recovery.run();

        const all = await adapter.getAll();
        for (const j of all) {
            expect(j.state).not.toBe(JobState.ACTIVE);
        }
    });

    it('loads snapshot and replays WAL after snapshot seq', async () => {
        const adapter = new MemoryAdapter();
        const job = createJob(
            { type: 'snap-test', payload: {} },
            { defaultPriority: 5, defaultMaxAttempts: 3, defaultMaxDuration: 30_000 },
        );
        await adapter.push(job);

        const wal = new WALWriter(walPath);
        wal.initialize();
        wal.append('ENQUEUE', job.id, job);

        // Write snapshot at seq 0
        const snap = new Snapshot(snapshotPath, adapter);
        await snap.write(0);

        // Append more WAL after snapshot
        const job2 = createJob(
            { type: 'after-snap', payload: {} },
            { defaultPriority: 5, defaultMaxAttempts: 3, defaultMaxDuration: 30_000 },
        );
        wal.append('ENQUEUE', job2.id, job2);

        // Recover into fresh adapter
        const freshAdapter = new MemoryAdapter();
        const recovery = new Recovery(wal, snap, freshAdapter);
        await recovery.run();

        const all = await freshAdapter.getAll();
        const ids = all.map((j) => j.id);
        expect(ids).toContain(job.id);   // from snapshot
        expect(ids).toContain(job2.id);  // from WAL replay
    });

    it('replays COMPLETE: removes job from adapter', async () => {
        const adapter = new MemoryAdapter();
        const wal = new WALWriter(walPath);
        wal.initialize();
        const job = createJob(
            { type: 'x', payload: {} },
            { defaultPriority: 5, defaultMaxAttempts: 3, defaultMaxDuration: 30_000 },
        );
        await adapter.push(job);
        wal.append('ENQUEUE', job.id, job);
        wal.append('COMPLETE', job.id, { ok: true, value: null });

        const snap = new Snapshot(snapshotPath, adapter);
        const recovery = new Recovery(wal, snap, adapter);
        await recovery.run();
        const all = await adapter.getAll();
        const found = all.find((j) => j.id === job.id);
        // Job was completed — may be removed
        expect(found).toBeUndefined();
    });
});
