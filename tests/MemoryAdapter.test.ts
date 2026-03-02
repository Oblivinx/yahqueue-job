import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryAdapter } from '../src/adapters/MemoryAdapter.js';
import { JobBuilder } from '../src/core/JobBuilder.js';

describe('MemoryAdapter', () => {
    let adapter: MemoryAdapter;

    beforeEach(() => {
        adapter = new MemoryAdapter();
    });

    it('should push and pop a job', async () => {
        const job = JobBuilder.from('test').build();
        await adapter.push(job);
        const popped = await adapter.pop();
        expect(popped).toEqual(job);
    });

    it('should pop jobs by priority first', async () => {
        const job1 = JobBuilder.from('low').priority(10).build();
        const job2 = JobBuilder.from('high').priority(1).build();
        await adapter.push(job1);
        await adapter.push(job2);

        const poppedFirst = await adapter.pop();
        expect(poppedFirst?.payload).toBe('high');
        const poppedSecond = await adapter.pop();
        expect(poppedSecond?.payload).toBe('low');
    });

    it('should not pop delayed jobs until runAt', async () => {
        const job = JobBuilder.from('delayed').delay(5000).build();
        await adapter.push(job);

        const popped = await adapter.pop();
        expect(popped).toBeNull();
    });

    it('should update and remove jobs', async () => {
        const job = JobBuilder.from('update').build();
        await adapter.push(job);

        job.status = 'active';
        await adapter.update(job);

        const fetched = await adapter.get(job.id);
        expect(fetched?.status).toBe('active');

        await adapter.remove(job.id);
        const popped = await adapter.pop();
        expect(popped).toBeNull();
    });

    it('should calculate size of pending/delayed jobs only', async () => {
        const pendingJob = JobBuilder.from('pending').build();
        const activeJob = JobBuilder.from('active').build();
        activeJob.status = 'active';

        await adapter.push(pendingJob);
        // Directly push active to bypass sort logic that filters by pending for pop
        await adapter.update(activeJob); // since it's not active already in list, memory adapter adds it back

        expect(await adapter.size()).toBe(1);

        await adapter.clear();
        expect(await adapter.size()).toBe(0);

        await adapter.close(); // just clears
        expect(await adapter.size()).toBe(0);
    });
});
