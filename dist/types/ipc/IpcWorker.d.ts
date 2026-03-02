import type { JobQueue } from '../core/JobQueue.js';
export declare class IpcWorker {
    private readonly queue;
    constructor(queue: JobQueue);
    /**
     * Start listening to IPC messages from the IpcRouter (main process).
     */
    start(): void;
    private handleMessage;
}
