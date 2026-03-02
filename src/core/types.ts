export interface JobPayload<T = unknown> {
    [key: string]: any;
}

export interface JobOptions<T = unknown> {
    payload: T;
    priority?: number; // Lower number means higher priority
    maxRetries?: number;
    timeout?: number;
    delay?: number; // Delay in milliseconds before job can start
}

export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'delayed';

export interface Job<T = unknown> {
    id: string;
    payload: T;
    priority: number;
    maxRetries: number;
    attempts: number;
    timeout: number;
    status: JobStatus;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    runAt: number; // For delayed or scheduled jobs
}

export interface QueueOptions {
    name: string;
    concurrency?: number;
    adapter?: 'memory' | 'sqlite';
    retention?: number; // How long to keep completed/failed jobs
}

export interface RetryPolicy {
    nextDelay(attempts: number, error: Error): number;
}
