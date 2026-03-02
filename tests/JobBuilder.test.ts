import { describe, it, expect } from 'vitest';
import { JobBuilder } from '../src/core/JobBuilder.js';

describe('JobBuilder', () => {
    it('should build a job with default values', () => {
        const job = JobBuilder.from({ data: 1 }).build();
        expect(job.payload).toEqual({ data: 1 });
        expect(job.priority).toBe(0);
        expect(job.maxRetries).toBe(3);
        expect(job.timeout).toBe(30000);
        expect(job.status).toBe('pending');
        expect(job.attempts).toBe(0);
        expect(job.id).toBeDefined();
        expect(job.createdAt).toBeLessThanOrEqual(Date.now());
        expect(job.runAt).toBe(job.createdAt);
    });

    it('should build a job with chained methods', () => {
        const job = JobBuilder.from('test')
            .priority(5)
            .maxRetries(10)
            .timeout(5000)
            .delay(1000)
            .build();

        expect(job.payload).toBe('test');
        expect(job.priority).toBe(5);
        expect(job.maxRetries).toBe(10);
        expect(job.timeout).toBe(5000);
        expect(job.status).toBe('delayed');
        expect(job.runAt).toBe(job.createdAt + 1000);
    });

    it('should build a job from options', () => {
        const builder = new JobBuilder<string>();
        builder.fromOptions({
            payload: 'hello',
            priority: 1,
            maxRetries: 2,
            timeout: 1000,
            delay: 500
        });
        const job = builder.build();
        expect(job.payload).toBe('hello');
        expect(job.priority).toBe(1);
        expect(job.maxRetries).toBe(2);
        expect(job.timeout).toBe(1000);
        expect(job.status).toBe('delayed');
        expect(job.runAt).toBe(job.createdAt + 500);
    });
});
