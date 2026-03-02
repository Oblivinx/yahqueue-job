import { EventEmitter } from 'events';
import { IStorageAdapter } from '../adapters/IStorageAdapter.js';
import { Job, JobOptions, QueueOptions } from './types.js';
export declare class JobQueue<T = unknown> extends EventEmitter {
    private adapter;
    private isProcessing;
    private workers;
    private concurrency;
    private isClosed;
    constructor(options: QueueOptions, adapter?: IStorageAdapter);
    /**
     * Enqueue a new job
     * @param options - Job configuration options
     * @returns The created Job
     */
    enqueue(options: JobOptions<T>): Promise<Job<T>>;
    /**
     * Start processing the queue automatically
     */
    start(): void;
    /**
     * Stop processing the queue
     */
    pause(): void;
    /**
     * Get the current sizing of the queue (pending jobs)
     */
    size(): Promise<number>;
    /**
     * Clear all jobs
     */
    clear(): Promise<void>;
    /**
     * Close the adapter and reject new jobs
     */
    close(): Promise<void>;
    private checkClosed;
    private triggerProcessing;
    private processNextJob;
    private _processor?;
    /**
     * Register a processor function for the queue
     */
    process(handler: (job: Job<T>) => Promise<void>): void;
    private runHandler;
}
