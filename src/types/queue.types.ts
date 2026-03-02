import type { IPlugin } from './plugin.types.js';
import type { IStorageAdapter } from './adapter.types.js';

/** Configuration for the worker auto-scaling pool */
export interface WorkerConfig {
    min: number;
    max: number;
    scaleUpThreshold: number;
    scaleDownThreshold: number;
    scaleUpStep: number;
    monitorIntervalMs: number;
}

/** Persistence / crash recovery configuration */
export interface PersistenceConfig {
    walPath: string;
    snapshotPath: string;
    snapshotIntervalMs: number;
    enabled: boolean;
}

/** Full queue configuration */
export interface QueueConfig {
    name: string;
    adapter?: IStorageAdapter;
    workers?: Partial<WorkerConfig>;
    persistence?: Partial<PersistenceConfig>;
    plugins?: IPlugin[];
    defaultPriority?: number;
    defaultMaxAttempts?: number;
    defaultMaxDuration?: number;
}

/** Resolved (filled-with-defaults) queue configuration */
export interface ResolvedQueueConfig {
    name: string;
    adapter: IStorageAdapter;
    workers: WorkerConfig;
    persistence: PersistenceConfig;
    plugins: IPlugin[];
    defaultPriority: number;
    defaultMaxAttempts: number;
    defaultMaxDuration: number;
}

/** Metrics snapshot returned by queue.metrics.snapshot() */
export interface MetricsSnapshot {
    processed: number;
    failed: number;
    retried: number;
    expired: number;
    depth: number;
    avgLatencyMs: number;
    activeWorkers: number;
}
