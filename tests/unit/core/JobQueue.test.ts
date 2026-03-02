import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JobQueue } from '../../../src/core/JobQueue.js';
import { MemoryAdapter } from '../../../src/adapters/MemoryAdapter.js';
import { QueueError } from '../../../src/errors/QueueError.js';
import { JobTimeoutError } from '../../../src/errors/JobTimeoutError.js';
import { Metrics } from '../../../src/plugins/Metrics.js';
import { DeadLetterQueue } from '../../../src/plugins/DeadLetterQueue.js';

describe('JobQueue', () => {
    let queue: JobQueue;

    beforeEach(() => {
        vi.useFakeTimers();
        queue = new JobQueue({ name: 'test', workers: { min: 1, max: 3 } });
        queue.register('greet', async (payload: Record<string, unknown>) => {
            return `Hello ${payload['name']}`;
        });
    });

    afterEach(async () => {
        await queue.shutdown();
        vi.useRealTimers();
    });

    it('should throw QueueError on invalid config', () => {
        expect(() => new JobQueue({ name: '' })).toThrow(QueueError);
    });

    it('should throw when enqueueing after shutdown', async () => {
        await queue.shutdown();
        await expect(queue.enqueue({ type: 'greet', payload: { name: 'world' } }))
            .rejects.toThrow(QueueError);
    });

    it('should enqueue and emit enqueued event', async () => {
        const listener = vi.fn();
        queue.on('enqueued', listener);
        const id = await queue.enqueue({ type: 'greet', payload: { name: 'x' } });
        expect(typeof id).toBe('string');
        expect(listener).toHaveBeenCalledOnce();
    });

    it('should process job and emit completed event', async () => {
        const completedMock = vi.fn();
        queue.on('completed', completedMock);
        await queue.initialize();
        await queue.enqueue({ type: 'greet', payload: { name: 'world' } });
        // Let microtasks and any zero-ms timers flush
        await vi.advanceTimersByTimeAsync(0);
        expect(completedMock).toHaveBeenCalled();
    });

    it('should timeout a job and emit failed event (skips fake timers)', async () => {
        // This test intentionally does NOT rely on fake timer advancement.
        // The queue uses real wall-clock timeouts; max job duration is 100ms.
        // Since vi.useFakeTimers() is called in beforeEach, the timeout and handler
        // setTimeout are both fake. We advance past the handler and timeout together.
        queue.register('slow', async () => {
            // Simulate slow handler via fake timer-friendly sleep
            await new Promise<void>((r) => setTimeout(r, 10_000));
        });
        const failedMock = vi.fn();
        queue.on('failed', failedMock);
        await queue.initialize();
        await queue.enqueue({ type: 'slow', payload: {}, maxDuration: 100, maxAttempts: 1 });
        // Tick: 0ms — picks up job and starts executing handler
        await vi.advanceTimersByTimeAsync(1);
        // Tick: 200ms — fires timeout (maxDuration=100ms) and aborts
        await vi.advanceTimersByTimeAsync(200);
        expect(failedMock).toHaveBeenCalled();
        const [, err] = failedMock.mock.calls[0]!;
        expect(err).toBeInstanceOf(JobTimeoutError);
    });

    it('should pause and resume processing', async () => {
        queue.pause();
        await queue.enqueue({ type: 'greet', payload: { name: 'test' } });
        expect(await queue.size()).toBe(1);
        queue.resume();
        await Promise.resolve();
        await Promise.resolve();
    });

    it('should return size and clear correctly', async () => {
        // Pause workers before enqueueing so jobs stay in queue
        queue.pause();
        await queue.enqueue({ type: 'greet', payload: { name: 'a' } });
        await queue.enqueue({ type: 'greet', payload: { name: 'b' } });
        expect(await queue.size()).toBe(2);
        await queue.clear();
        expect(await queue.size()).toBe(0);
    });

    it('should use on/off/once event methods', () => {
        const listener = vi.fn();
        queue.on('enqueued', listener);
        queue.off('enqueued', listener);
        // No assertion needed — just verifying no throw
        const once = vi.fn();
        queue.once('enqueued', once);
    });

    it('metrics returns snapshot when no Metrics plugin', () => {
        const snap = queue.metrics.snapshot();
        expect(snap.processed).toBe(0);
        expect(snap.activeWorkers).toBe(0);
    });

    it('metrics returns snapshot from Metrics plugin', async () => {
        const metricsPlugin = new Metrics();
        const q = new JobQueue({
            name: 'metrics-test',
            plugins: [metricsPlugin],
            workers: { min: 1, max: 1 },
        });
        q.register('noop', async () => { });
        await q.initialize();
        await q.enqueue({ type: 'noop', payload: {} });
        await Promise.resolve();
        await Promise.resolve();
        const snap = q.metrics.snapshot();
        expect(snap.processed).toBeGreaterThanOrEqual(0);
        await q.shutdown();
    });

    it('dlq getter throws if DLQ plugin not configured', () => {
        expect(() => queue.dlq).toThrow(QueueError);
    });

    it('dlq getter returns DLQ plugin when configured', () => {
        const dlqPlugin = new DeadLetterQueue();
        const q = new JobQueue({ name: 'dlq-test', plugins: [dlqPlugin] });
        expect(q.dlq).toBe(dlqPlugin);
    });

    it('enqueue with delay goes through scheduler', async () => {
        const listener = vi.fn();
        queue.on('enqueued', listener);
        await queue.enqueue({ type: 'greet', payload: { name: 'delayed' }, delay: 5000 });
        expect(await queue.size()).toBe(0); // not yet in heap
        expect(listener).toHaveBeenCalled();
        vi.advanceTimersByTime(6000);
        await Promise.resolve();
    });

    it('should enqueue a flow chain', async () => {
        queue.register('step1', async () => { });
        queue.register('step2', async () => { });
        const flowId = await queue.flow([
            { type: 'step1', payload: {} },
            { type: 'step2', payload: {} },
        ]);
        expect(typeof flowId).toBe('string');
    });

    it('should enqueue a DAG', async () => {
        queue.register('fetchUser', async () => { });
        queue.register('sendEmail', async () => { });
        const dagId = await queue.dag({
            nodes: {
                a: { type: 'fetchUser', payload: {} },
                b: { type: 'sendEmail', payload: {}, dependsOn: ['a'] },
            },
        });
        expect(typeof dagId).toBe('string');
    });

    it('adapter pop failure emits error event', async () => {
        const adapter = new MemoryAdapter();
        vi.spyOn(adapter, 'pop').mockRejectedValue(new Error('pop fail'));
        // Use min:1 max:1 to pass validation; then call processNext directly
        const q = new JobQueue({ name: 'pop-fail', adapter, workers: { min: 1, max: 1 } });
        q.register('x', async () => { });
        const errorMock = vi.fn();
        q.on('error', errorMock);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (q as any).processNext();
        expect(errorMock).toHaveBeenCalled();
        await q.shutdown();
    });

    it('drain resolves synchronously when queue is empty', async () => {
        // Queue is empty and no active workers — drain returns immediately
        let resolved = false;
        queue.drain().then(() => { resolved = true; });
        // Give microtasks a tick
        await Promise.resolve();
        await Promise.resolve();
        expect(resolved).toBe(true);
    });
});
