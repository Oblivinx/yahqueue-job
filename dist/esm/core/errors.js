export class JobQueueError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'JobQueueError';
        Object.setPrototypeOf(this, JobQueueError.prototype);
    }
}
export class AdapterError extends JobQueueError {
    constructor(message, cause) {
        super(message, cause);
        this.name = 'AdapterError';
        Object.setPrototypeOf(this, AdapterError.prototype);
    }
}
export class JobTimeoutError extends JobQueueError {
    jobId;
    timeoutDuration;
    constructor(jobId, timeoutDuration) {
        super(`Job ${jobId} timed out after ${timeoutDuration}ms`);
        this.jobId = jobId;
        this.timeoutDuration = timeoutDuration;
        this.name = 'JobTimeoutError';
        Object.setPrototypeOf(this, JobTimeoutError.prototype);
    }
}
export class RateLimitError extends JobQueueError {
    constructor(message = 'Rate limit exceeded') {
        super(message);
        this.name = 'RateLimitError';
        Object.setPrototypeOf(this, RateLimitError.prototype);
    }
}
