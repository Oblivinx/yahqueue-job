import { IStorageAdapter } from './IStorageAdapter.js';
import { Job } from '../core/types.js';
export declare class MemoryAdapter implements IStorageAdapter {
    private items;
    constructor();
    push<T>(job: Job<T>): Promise<void>;
    pop<T>(): Promise<Job<T> | null>;
    get<T>(id: string): Promise<Job<T> | null>;
    update<T>(job: Job<T>): Promise<void>;
    remove(id: string): Promise<void>;
    size(): Promise<number>;
    clear(): Promise<void>;
    close(): Promise<void>;
    private sort;
}
