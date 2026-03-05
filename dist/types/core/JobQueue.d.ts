import type { JobPayload, JobOptions, JobHandler, MetricsSnapshot } from '../types/index.js';
import type { QueueConfig } from '../types/queue.types.js';
import type { ChainStep, DAGConfig } from '../types/flow.types.js';
import { TypedEventEmitter } from '../events/EventEmitter.js';
import { DeadLetterQueue } from '../plugins/DeadLetterQueue.js';
type QueueEventName = Parameters<TypedEventEmitter['on']>[0];
type QueueEventListener = Parameters<TypedEventEmitter['on']>[1];
/**
 * JobQueue — the main orchestrator.
 *
 * @example
 * const queue = new JobQueue({ name: 'main', workers: { min: 1, max: 5 } });
 * queue.register('sendMessage', async (payload, ctx) => { ... });
 * await queue.initialize();
 * const id = await queue.enqueue({ type: 'sendMessage', payload: { ... } });
 */
export declare class JobQueue {
    private readonly cfg;
    private readonly registry;
    private readonly scheduler;
    private readonly flowController;
    private readonly emitter;
    private readonly wal;
    private readonly snapshot;
    private readonly recovery;
    private readonly defaultRetry;
    private activeWorkers;
    private pendingWorkers;
    private isClosed;
    private isPaused;
    private drainResolvers;
    private readonly workers;
    constructor(config: QueueConfig);
    on(event: QueueEventName, listener: QueueEventListener): this;
    once(event: QueueEventName, listener: QueueEventListener): this;
    off(event: QueueEventName, listener: QueueEventListener): this;
    /**
     * Initialize the queue: run WAL recovery if persistence is enabled, start workers.
     */
    initialize(): Promise<void>;
    /** Register a job handler for a given type */
    register<T extends JobPayload>(type: string, handler: JobHandler<T>): void;
    /**
     * Enqueue a job.
     * @returns The job ID
     * @throws QueueError if queue is closed
     */
    enqueue<T extends JobPayload>(options: JobOptions<T>): Promise<string>;
    /** Enqueue a linear chain of jobs (A → B → C) */
    flow(steps: ChainStep[]): Promise<string>;
    /** Enqueue a DAG of jobs with dependencies */
    dag(config: DAGConfig): Promise<string>;
    /** Pause processing — in-flight jobs finish, new ones are not started */
    pause(): void;
    /** Resume processing after a pause */
    resume(): void;
    /**
     * Drain: wait until all currently pending AND active jobs complete.
     */
    drain(): Promise<void>;
    /**
     * Gracefully shut down all workers.
     * Waits for in-flight jobs to complete.
     */
    shutdown(): Promise<void>;
    /** Get the current number of pending jobs */
    size(): Promise<number>;
    /** Clear all pending jobs */
    clear(): Promise<void>;
    /**
     * Run a job handler directly in-process, bypassing the queue entirely.
     *
     * Useful for:
     *  - Testing handlers without queue overhead
     *  - Urgent/synchronous one-off executions
     *  - Running jobs in contexts where queue workers are not started
     *
     * Plugin hooks (`onEnqueue`, `onProcess`, `onComplete`, `onFail`) are still
     * invoked so metrics, rate-limiters, and other plugins remain accurate.
     *
     * @returns The handler's return value on success
     * @throws The original handler error on failure (no retries)
     *
     * @example
     * const result = await queue.runInProcess('sendEmail', { to: 'a@b.com' });
     */
    runInProcess<T extends JobPayload, R = unknown>(type: string, payload: T, options?: Omit<JobOptions<T>, 'type' | 'payload'>): Promise<R>;
    /** Get metrics snapshot */
    get metrics(): {
        snapshot: (depth?: number) => MetricsSnapshot;
    };
    /** Get the DeadLetterQueue plugin if configured */
    get dlq(): DeadLetterQueue;
    private startWorkers;
    private spawnWorker;
    private triggerWorker;
    private runWorkerLoop;
    private processNext;
    private executeJob;
    private onSuccess;
    private onFailure;
    private handleExpire;
    private checkOpen;
    private checkDrain;
    private static _imports;
}
export {};
