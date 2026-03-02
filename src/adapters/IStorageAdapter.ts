import { Job } from '../core/types.js';

export interface IStorageAdapter {
    /**
     * Add a job to the queue
     */
    push<T>(job: Job<T>): Promise<void>;

    /**
     * Get and remove the highest priority job from the queue
     */
    pop<T>(): Promise<Job<T> | null>;

    /**
     * Get a generic job by id
     */
    get<T>(id: string): Promise<Job<T> | null>;

    /**
     * Update an existing job (status, attempts, etc)
     */
    update<T>(job: Job<T>): Promise<void>;

    /**
     * Remove a job completely
     */
    remove(id: string): Promise<void>;

    /**
     * Get the total size of pending jobs
     */
    size(): Promise<number>;

    /**
     * Clear all jobs
     */
    clear(): Promise<void>;

    /**
     * Disconnect or cleanup adapter resources
     */
    close(): Promise<void>;
}
