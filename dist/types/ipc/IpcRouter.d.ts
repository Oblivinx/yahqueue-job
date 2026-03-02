import type { ChildProcess } from 'child_process';
import type { JobOptions, JobPayload } from '../types/job.types.js';
import type { ShardedQueue } from './types.js';
export declare class IpcRouter implements ShardedQueue {
    private shards;
    private pendingRequests;
    private reqCounter;
    /**
     * Register a child process to handle jobs for a specific shardKey.
     */
    registerShard(shardKey: string, child: ChildProcess): void;
    enqueue<T extends JobPayload>(options: JobOptions<T>): Promise<string>;
    pause(): void;
    resume(): void;
    shutdown(): Promise<void>;
    private sendRequest;
}
