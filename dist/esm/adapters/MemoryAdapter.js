export class MemoryAdapter {
    items = [];
    constructor() { }
    async push(job) {
        this.items.push(job);
        this.sort();
    }
    async pop() {
        const now = Date.now();
        // Find the first job that is ready to run (not delayed, or delay passed)
        const index = this.items.findIndex(j => (j.status === 'pending' || j.status === 'delayed') && j.runAt <= now);
        if (index !== -1) {
            const job = this.items.splice(index, 1)[0];
            return job;
        }
        return null;
    }
    async get(id) {
        return this.items.find(j => j.id === id) || null;
    }
    async update(job) {
        const index = this.items.findIndex(j => j.id === job.id);
        if (index !== -1) {
            this.items[index] = job;
            this.sort();
        }
        else {
            // If updating an active job that is not in the array (popped earlier), we can add it back if needed, e.g., if it failed.
            if (job.status !== 'active') {
                this.items.push(job);
                this.sort();
            }
        }
    }
    async remove(id) {
        this.items = this.items.filter(j => j.id !== id);
    }
    async size() {
        return this.items.filter(j => j.status === 'pending' || j.status === 'delayed').length;
    }
    async clear() {
        this.items = [];
    }
    async close() {
        await this.clear();
    }
    sort() {
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
