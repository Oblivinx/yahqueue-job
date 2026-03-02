import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../../src/plugins/RateLimiter.js';
import { Deduplicator } from '../../../src/plugins/Deduplicator.js';
import { Metrics } from '../../../src/plugins/Metrics.js';
import { DeadLetterQueue } from '../../../src/plugins/DeadLetterQueue.js';
import { Throttle } from '../../../src/plugins/Throttle.js';
import { JobTTL } from '../../../src/plugins/JobTTL.js';
import { RateLimitError } from '../../../src/errors/RateLimitError.js';
import { QueueError } from '../../../src/errors/QueueError.js';
import { createJob } from '../../../src/job/Job.js';
import { JobResultFactory } from '../../../src/job/JobResult.js';
import type { Job, JobPayload } from '../../../src/types/job.types.js';

const defaults = { defaultPriority: 5, defaultMaxAttempts: 3, defaultMaxDuration: 30_000 };

function makeJob(type = 'test', ttl?: number): Job<JobPayload> {
    return createJob({ type, payload: {}, ttl }, defaults);
}

describe('Plugins', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    describe('RateLimiter', () => {
        it('allows jobs within limit', () => {
            const rl = new RateLimiter({ limit: 3, windowMs: 1000 });
            const job = makeJob();
            expect(() => rl.onEnqueue(job)).not.toThrow();
            expect(() => rl.onEnqueue(makeJob())).not.toThrow();
            expect(() => rl.onEnqueue(makeJob())).not.toThrow();
        });

        it('throws RateLimitError when limit exceeded', () => {
            const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
            rl.onEnqueue(makeJob());
            rl.onEnqueue(makeJob());
            expect(() => rl.onEnqueue(makeJob())).toThrow(RateLimitError);
        });

        it('resets bucket after window', () => {
            const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
            rl.onEnqueue(makeJob());
            expect(() => rl.onEnqueue(makeJob())).toThrow(RateLimitError);
            vi.advanceTimersByTime(1001);
            expect(() => rl.onEnqueue(makeJob())).not.toThrow();
        });

        it('uses custom key function', () => {
            const rl = new RateLimiter({
                limit: 1,
                windowMs: 1000,
                keyFn: (j) => 'fixed-key',
            });
            rl.onEnqueue(makeJob());
            expect(() => rl.onEnqueue(makeJob())).toThrow(RateLimitError);
        });
    });

    describe('Deduplicator', () => {
        it('allows unique jobs', () => {
            const dedup = new Deduplicator();
            const job = makeJob();
            expect(() => dedup.onEnqueue(job)).not.toThrow();
        });

        it('throws on duplicate job id', () => {
            const dedup = new Deduplicator();
            const job = makeJob();
            dedup.onEnqueue(job);
            expect(() => dedup.onEnqueue(job)).toThrow(QueueError);
        });

        it('removes from set on complete', () => {
            const dedup = new Deduplicator();
            const job = makeJob();
            dedup.onEnqueue(job);
            dedup.onComplete(job, JobResultFactory.success(null));
            expect(() => dedup.onEnqueue(job)).not.toThrow();
        });

        it('removes from set on fail', () => {
            const dedup = new Deduplicator();
            const job = makeJob();
            dedup.onEnqueue(job);
            dedup.onFail(job, new Error('fail'));
            expect(() => dedup.onEnqueue(job)).not.toThrow();
        });

        it('removes from set on expire', () => {
            const dedup = new Deduplicator();
            const job = makeJob();
            dedup.onEnqueue(job);
            dedup.onExpire(job);
            expect(dedup.size).toBe(0);
        });
    });

    describe('Metrics', () => {
        it('tracks processed count', () => {
            const m = new Metrics();
            const job = makeJob();
            m.onProcess(job);
            m.onComplete(job, JobResultFactory.success(null));
            expect(m.snapshot().processed).toBe(1);
        });

        it('tracks failed count', () => {
            const m = new Metrics();
            const job = makeJob();
            m.onProcess(job);
            m.onFail(job, new Error('fail'));
            expect(m.snapshot().failed).toBe(1);
        });

        it('tracks expired count', () => {
            const m = new Metrics();
            const job = makeJob();
            m.onExpire(job);
            expect(m.snapshot().expired).toBe(1);
        });

        it('tracks retry count', () => {
            const m = new Metrics();
            m.recordRetry();
            m.recordRetry();
            expect(m.snapshot().retried).toBe(2);
        });

        it('calculates avgLatencyMs', () => {
            const m = new Metrics();
            const job = makeJob();
            m.onProcess(job);
            vi.advanceTimersByTime(100);
            m.onComplete(job, JobResultFactory.success(null));
            expect(m.snapshot().avgLatencyMs).toBeGreaterThanOrEqual(0);
        });

        it('activeWorkers decrements on fail and stays >=0', () => {
            const m = new Metrics();
            const job = makeJob();
            m.onFail(job, new Error('x'));
            expect(m.snapshot().activeWorkers).toBe(0); // floor at 0
        });

        it('reset clears all counters', () => {
            const m = new Metrics();
            const job = makeJob();
            m.onProcess(job);
            m.onComplete(job, JobResultFactory.success(null));
            m.reset();
            expect(m.snapshot().processed).toBe(0);
        });
    });

    describe('DeadLetterQueue', () => {
        it('captures failed jobs', () => {
            const dlq = new DeadLetterQueue();
            const job = makeJob();
            dlq.onFail(job, new Error('boom'));
            expect(dlq.size).toBe(1);
            expect(dlq.get(job.id)?.job.id).toBe(job.id);
        });

        it('list returns all entries', () => {
            const dlq = new DeadLetterQueue();
            dlq.onFail(makeJob(), new Error('a'));
            dlq.onFail(makeJob(), new Error('b'));
            expect(dlq.list()).toHaveLength(2);
        });

        it('removes entry on complete (DLQ retry succeeded)', () => {
            const dlq = new DeadLetterQueue();
            const job = makeJob();
            dlq.onFail(job, new Error('fail'));
            dlq.onComplete(job, JobResultFactory.success(null));
            expect(dlq.size).toBe(0);
        });

        it('retry throws if job not in DLQ', async () => {
            const dlq = new DeadLetterQueue();
            await expect(dlq.retry('unknown')).rejects.toThrow();
        });

        it('retry throws if no enqueue callback', async () => {
            const dlq = new DeadLetterQueue();
            const job = makeJob();
            dlq.onFail(job, new Error('fail'));
            await expect(dlq.retry(job.id)).rejects.toThrow('no enqueue callback');
        });

        it('retry calls enqueue callback and removes from DLQ', async () => {
            const dlq = new DeadLetterQueue();
            const cb = vi.fn().mockResolvedValue(undefined);
            dlq.setEnqueueCallback(cb);
            const job = makeJob();
            dlq.onFail(job, new Error('fail'));
            await dlq.retry(job.id);
            expect(cb).toHaveBeenCalledOnce();
            expect(dlq.size).toBe(0);
        });

        it('retryAll retries all jobs', async () => {
            const dlq = new DeadLetterQueue();
            const cb = vi.fn().mockResolvedValue(undefined);
            dlq.setEnqueueCallback(cb);
            dlq.onFail(makeJob(), new Error('a'));
            dlq.onFail(makeJob(), new Error('b'));
            await dlq.retryAll();
            expect(cb).toHaveBeenCalledTimes(2);
        });

        it('purge removes old entries', () => {
            const dlq = new DeadLetterQueue();
            dlq.onFail(makeJob(), new Error('old'));
            vi.advanceTimersByTime(10_000);
            const removed = dlq.purge(Date.now() - 5_000);
            expect(removed).toBe(1);
            expect(dlq.size).toBe(0);
        });
    });

    describe('Throttle', () => {
        it('allows jobs within limit', () => {
            const t = new Throttle({ maxConcurrent: 2 });
            expect(() => t.onProcess(makeJob())).not.toThrow();
            expect(() => t.onProcess(makeJob())).not.toThrow();
        });

        it('throws RateLimitError when exceeded', () => {
            const t = new Throttle({ maxConcurrent: 1 });
            t.onProcess(makeJob());
            expect(() => t.onProcess(makeJob())).toThrow(RateLimitError);
        });

        it('decrements on complete', () => {
            const t = new Throttle({ maxConcurrent: 1 });
            const job = makeJob();
            t.onProcess(job);
            t.onComplete(job);
            expect(t.current).toBe(0);
        });

        it('decrements on fail', () => {
            const t = new Throttle({ maxConcurrent: 1 });
            const job = makeJob();
            t.onProcess(job);
            t.onFail(job, new Error('x'));
            expect(t.current).toBe(0);
        });

        it('current stays >=0 even without onProcess', () => {
            const t = new Throttle({ maxConcurrent: 2 });
            t.onFail(makeJob(), new Error('x'));
            expect(t.current).toBe(0);
        });
    });

    describe('JobTTL', () => {
        it('calls expire callback after TTL', () => {
            const ttl = new JobTTL();
            const expiredMock = vi.fn();
            ttl.onExpireCallback(expiredMock);
            const job = makeJob('test', 1000);
            ttl.onEnqueue(job);
            vi.advanceTimersByTime(1100);
            expect(expiredMock).toHaveBeenCalledWith(job);
        });

        it('does not expire when job completes before TTL', () => {
            const ttl = new JobTTL();
            const expiredMock = vi.fn();
            ttl.onExpireCallback(expiredMock);
            const job = makeJob('test', 5000);
            ttl.onEnqueue(job);
            ttl.onComplete(job);
            vi.advanceTimersByTime(6000);
            expect(expiredMock).not.toHaveBeenCalled();
        });

        it('does not expire when job fails before TTL', () => {
            const ttl = new JobTTL();
            const expiredMock = vi.fn();
            ttl.onExpireCallback(expiredMock);
            const job = makeJob('test', 5000);
            ttl.onEnqueue(job);
            ttl.onFail(job, new Error('x'));
            vi.advanceTimersByTime(6000);
            expect(expiredMock).not.toHaveBeenCalled();
        });

        it('skips TTL for jobs without ttl field', () => {
            const ttl = new JobTTL();
            const expiredMock = vi.fn();
            ttl.onExpireCallback(expiredMock);
            const job = makeJob('test'); // no ttl
            ttl.onEnqueue(job);
            vi.advanceTimersByTime(10_000);
            expect(expiredMock).not.toHaveBeenCalled();
        });

        it('size returns active timer count', () => {
            const ttl = new JobTTL();
            const job = makeJob('test', 5000);
            ttl.onEnqueue(job);
            expect(ttl.size).toBe(1);
        });

        it('clear cancels all timers', () => {
            const ttl = new JobTTL();
            const expiredMock = vi.fn();
            ttl.onExpireCallback(expiredMock);
            ttl.onEnqueue(makeJob('test', 500));
            ttl.clear();
            vi.advanceTimersByTime(1000);
            expect(expiredMock).not.toHaveBeenCalled();
            expect(ttl.size).toBe(0);
        });
    });
});
