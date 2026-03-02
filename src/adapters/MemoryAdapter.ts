import { IStorageAdapter } from './IStorageAdapter.js';
import { Job, JobStatus } from '../core/types.js';

export class MemoryAdapter implements IStorageAdapter {
    private items: Job<any>[] = [];

    constructor() { }

    async push<T>(job: Job<T>): Promise<void> {
        this.items.push(job);
        this.sort();
    }

    async pop<T>(): Promise<Job<T> | null> {
        const now = Date.now();
        // Find the first job that is ready to run (not delayed, or delay passed)
        const index = this.items.findIndex(j => (j.status === 'pending' || j.status === 'delayed') && j.runAt <= now);
        if (index !== -1) {
            const job = this.items.splice(index, 1)[0];
            return job;
        }
        return null;
    }

    async get<T>(id: string): Promise<Job<T> | null> {
        return this.items.find(j => j.id === id) || null;
    }

    async update<T>(job: Job<T>): Promise<void> {
        const index = this.items.findIndex(j => j.id === job.id);
        if (index !== -1) {
            this.items[index] = job;
            this.sort();
        } else {
            // If updating an active job that is not in the array (popped earlier), we can add it back if needed, e.g., if it failed.
            if (job.status !== 'active') {
                this.items.push(job);
                this.sort();
            }
        }
    }

    async remove(id: string): Promise<void> {
        this.items = this.items.filter(j => j.id !== id);
    }

    async size(): Promise<number> {
        return this.items.filter(j => j.status === 'pending' || j.status === 'delayed').length;
    }

    async clear(): Promise<void> {
        this.items = [];
    }

    async close(): Promise<void> {
        await this.clear();
    }

    private sort() {
        this.items.sort((a, b) => {
            // Primary sort: runAt (delayed jobs go later)
            // Only jobs with runAt <= now should be considered for immediate popping
            if (a.runAt !== b.runAt) {
                return a.runAt - b.runAt;
            }
            // Secondary sort: priority (lower number = higher priority)
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            // Tertiary sort: chronological creation (FIFO for same priority)
            return a.createdAt - b.createdAt;
        });
    }
}
