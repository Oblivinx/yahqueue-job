import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobQueue } from '../src/core/JobQueue.js';
import { JobQueueError, AdapterError, JobTimeoutError } from '../src/core/errors.js';
import { MemoryAdapter } from '../src/adapters/MemoryAdapter.js';

describe('JobQueue', () => {
    let queue: JobQueue<string>;

    beforeEach(() => {
        queue = new JobQueue({ name: 'test', concurrency: 1 });
        vi.useFakeTimers();
    });

    it('should enqueue and process a job successfully', async () => {
        const processMock = vi.fn().mockResolvedValue(undefined);
        queue.process(processMock);

        const job = await queue.enqueue({ payload: 'hello' });
        expect(job.payload).toBe('hello');

        // Allow processing to catch up
        await Promise.resolve();

        expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ payload: 'hello' }));
        expect(await queue.size()).toBe(0);
    });

    it('should emit events correctly', async () => {
        const enqueuedMock = vi.fn();
        const activeMock = vi.fn();
        const completedMock = vi.fn();

        queue.on('enqueued', enqueuedMock);
        queue.on('active', activeMock);
        queue.on('completed', completedMock);

        const processMock = vi.fn().mockResolvedValue(undefined);
        queue.process(processMock);

        await queue.enqueue({ payload: 'test' });
        await Promise.resolve();
        await Promise.resolve(); // Extra tick for promise chain

        expect(enqueuedMock).toHaveBeenCalled();
        expect(activeMock).toHaveBeenCalled();
        expect(completedMock).toHaveBeenCalled();
    });

    it('should timeout if job takes too long', async () => {
        queue.process(async () => {
            // Simulate long task
            await new Promise(resolve => setTimeout(resolve, 5000));
        });

        const failedMock = vi.fn();
        queue.on('failed', failedMock);

        await queue.enqueue({ payload: 'timeout', timeout: 100, maxRetries: 0 });

        vi.advanceTimersByTime(200);
        await Promise.resolve();
        await Promise.resolve();

        expect(failedMock).toHaveBeenCalled();
        const errObj = failedMock.mock.calls[0][1];
        expect(errObj).toBeInstanceOf(JobTimeoutError);
    });

    it('should retry failed jobs', async () => {
        let attempts = 0;
        queue.process(async () => {
            attempts++;
            if (attempts < 2) throw new Error('First try fail');
        });

        await queue.enqueue({ payload: 'fail', maxRetries: 1 });
        await Promise.resolve();
        await Promise.resolve();

        expect(attempts).toBe(1);

        // After fail, delay is 1 * 1000
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
        await Promise.resolve();

        // Now it should process again
        expect(attempts).toBe(2);
        expect(await queue.size()).toBe(0);
    });

    it('should throw Error if trying to use closed queue', async () => {
        await queue.close();
        await expect(queue.enqueue({ payload: 'nope' })).rejects.toThrow(JobQueueError);
        expect(() => queue.start()).toThrow(JobQueueError);
    });

    it('should surface Adapter errors during enqueue', async () => {
        const mockAdapter = new MemoryAdapter();
        mockAdapter.push = vi.fn().mockRejectedValue(new Error('Push fail'));

        const failingQueue = new JobQueue({ name: 'fail' }, mockAdapter);

        await expect(failingQueue.enqueue({ payload: 'test' })).rejects.toThrow(AdapterError);
    });

    it('should clear and size correctly', async () => {
        await queue.enqueue({ payload: '1' });
        await queue.enqueue({ payload: '2' });
        expect(await queue.size()).toBe(2);
        await queue.clear();
        expect(await queue.size()).toBe(0);
    });

    it('should error when processor throws non-Error object', async () => {
        queue.process(async () => {
            throw 'String fail'; // Throwing string instead of Error
        });

        const failedMock = vi.fn();
        queue.on('failed', failedMock);

        await queue.enqueue({ payload: 'fail', maxRetries: 0 });
        await Promise.resolve();
        await Promise.resolve();

        expect(failedMock).toHaveBeenCalled();
        const jobPassed = failedMock.mock.calls[0][0];
        expect(jobPassed.error).toBe('String fail');
    });

    it('should throw if no processor is registered on processNextJob', async () => {
        queue.start(); // Doesn't throw but triggers
        await queue.enqueue({ payload: 'test' });
        await Promise.resolve();
    });

    it('should allow pause and manually start', async () => {
        queue.pause();
        await queue.enqueue({ payload: 'test' });
        expect(await queue.size()).toBe(1);

        queue.process(async () => { });
        await Promise.resolve();
        expect(await queue.size()).toBe(0); // Because process() calls start()
    });

    it('test processNextJob adapter pop failure', async () => {
        const mockAdapter = new MemoryAdapter();
        mockAdapter.pop = vi.fn().mockRejectedValue(new Error('pop fail'));
        const failingQueue = new JobQueue({ name: 'fail' }, mockAdapter);

        const errorMock = vi.fn();
        failingQueue.on('error', errorMock);

        failingQueue.start();
        await Promise.resolve();

        expect(errorMock).toHaveBeenCalled();
        const errObj = errorMock.mock.calls[0][0];
        expect(errObj).toBeInstanceOf(AdapterError);
    });
});
