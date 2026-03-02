export class JobQueueError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = 'JobQueueError';
        Object.setPrototypeOf(this, JobQueueError.prototype);
    }
}

export class AdapterError extends JobQueueError {
    constructor(message: string, cause?: unknown) {
        super(message, cause);
        this.name = 'AdapterError';
        Object.setPrototypeOf(this, AdapterError.prototype);
    }
}

export class JobTimeoutError extends JobQueueError {
    constructor(public readonly jobId: string, public readonly timeoutDuration: number) {
        super(`Job ${jobId} timed out after ${timeoutDuration}ms`);
        this.name = 'JobTimeoutError';
        Object.setPrototypeOf(this, JobTimeoutError.prototype);
    }
}

export class RateLimitError extends JobQueueError {
    constructor(message: string = 'Rate limit exceeded') {
        super(message);
        this.name = 'RateLimitError';
        Object.setPrototypeOf(this, RateLimitError.prototype);
    }
}
