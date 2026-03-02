"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryAdapter = void 0;
const PriorityHeap_js_1 = require("../core/PriorityHeap.cjs");
const AdapterError_js_1 = require("../errors/AdapterError.cjs");
/**
 * MemoryAdapter — default in-process adapter, zero external dependencies.
 * Uses PriorityHeap internally for O(log n) priority scheduling.
 */
class MemoryAdapter {
    heap = new PriorityHeap_js_1.PriorityHeap();
    /** Holds jobs in non-pending states (active, done, failed, etc.) */
    store = new Map();
    async push(job) {
        this.heap.insert(job);
    }
    async pop() {
        const now = Date.now();
        const job = this.heap.extractMin(now);
        if (!job)
            return null;
        return job;
    }
    async peek() {
        const now = Date.now();
        const job = this.heap.peekMin(now);
        if (!job)
            return null;
        return job;
    }
    async get(id) {
        // Check heap-still-pending jobs via toArray
        const inHeap = this.heap.toArray().find((j) => j.id === id);
        if (inHeap)
            return inHeap;
        return this.store.get(id) ?? null;
    }
    async update(job) {
        const inHeap = this.heap.toArray().find((j) => j.id === job.id);
        if (inHeap) {
            // Still in heap → update in place (e.g. state change while pending)
            this.heap.update(job);
        }
        else {
            this.store.set(job.id, job);
        }
    }
    async remove(id) {
        this.heap.remove(id);
        this.store.delete(id);
    }
    async size() {
        return this.heap.size;
    }
    async getAll() {
        const fromHeap = this.heap.toArray();
        const fromStore = Array.from(this.store.values());
        return [...fromHeap, ...fromStore];
    }
    async clear() {
        this.heap.clear();
        this.store.clear();
    }
    async close() {
        await this.clear();
        // Suppress unused import
        void AdapterError_js_1.AdapterError;
    }
}
exports.MemoryAdapter = MemoryAdapter;
