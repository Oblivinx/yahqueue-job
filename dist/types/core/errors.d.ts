export declare class JobQueueError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
export declare class AdapterError extends JobQueueError {
    constructor(message: string, cause?: unknown);
}
export declare class JobTimeoutError extends JobQueueError {
    readonly jobId: string;
    readonly timeoutDuration: number;
    constructor(jobId: string, timeoutDuration: number);
}
export declare class RateLimitError extends JobQueueError {
    constructor(message?: string);
}
