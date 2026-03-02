import type { IStorageAdapter } from '../types/adapter.types.js';
import type { Job, JobPayload } from '../types/job.types.js';
import { PriorityHeap } from '../core/PriorityHeap.js';
import { AdapterError } from '../errors/AdapterError.js';

/**
 * MemoryAdapter — default in-process adapter, zero external dependencies.
 * Uses PriorityHeap internally for O(log n) priority scheduling.
 */
export class MemoryAdapter implements IStorageAdapter {
    private readonly heap = new PriorityHeap();
    /** Holds jobs in non-pending states (active, done, failed, etc.) */
    private readonly store = new Map<string, Job<JobPayload>>();

    async push<T extends JobPayload>(job: Job<T>): Promise<void> {
        this.heap.insert(job);
    }

    async pop<T extends JobPayload>(): Promise<Job<T> | null> {
        const now = Date.now();
        const job = this.heap.extractMin(now);
        if (!job) return null;
        return job as Job<T>;
    }

    async peek<T extends JobPayload>(): Promise<Job<T> | null> {
        const now = Date.now();
        const job = this.heap.peekMin(now);
        if (!job) return null;
        return job as Job<T>;
    }

    async get<T extends JobPayload>(id: string): Promise<Job<T> | null> {
        // Check heap-still-pending jobs via toArray
        const inHeap = this.heap.toArray().find((j) => j.id === id);
        if (inHeap) return inHeap as Job<T>;
        return (this.store.get(id) as Job<T>) ?? null;
    }

    async update<T extends JobPayload>(job: Job<T>): Promise<void> {
        const inHeap = this.heap.toArray().find((j) => j.id === job.id);
        if (inHeap) {
            // Still in heap → update in place (e.g. state change while pending)
            this.heap.update(job);
        } else {
            this.store.set(job.id, job as Job<JobPayload>);
        }
    }

    async remove(id: string): Promise<void> {
        this.heap.remove(id);
        this.store.delete(id);
    }

    async size(): Promise<number> {
        return this.heap.size;
    }

    async getAll<T extends JobPayload>(): Promise<Job<T>[]> {
        const fromHeap = this.heap.toArray() as Job<T>[];
        const fromStore = Array.from(this.store.values()) as Job<T>[];
        return [...fromHeap, ...fromStore];
    }

    async clear(): Promise<void> {
        this.heap.clear();
        this.store.clear();
    }

    async close(): Promise<void> {
        await this.clear();
        // Suppress unused import
        void AdapterError;
    }
}
