"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitError = exports.JobTimeoutError = exports.AdapterError = exports.JobQueueError = void 0;
class JobQueueError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'JobQueueError';
        Object.setPrototypeOf(this, JobQueueError.prototype);
    }
}
exports.JobQueueError = JobQueueError;
class AdapterError extends JobQueueError {
    constructor(message, cause) {
        super(message, cause);
        this.name = 'AdapterError';
        Object.setPrototypeOf(this, AdapterError.prototype);
    }
}
exports.AdapterError = AdapterError;
class JobTimeoutError extends JobQueueError {
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
exports.JobTimeoutError = JobTimeoutError;
class RateLimitError extends JobQueueError {
    constructor(message = 'Rate limit exceeded') {
        super(message);
        this.name = 'RateLimitError';
        Object.setPrototypeOf(this, RateLimitError.prototype);
    }
}
exports.RateLimitError = RateLimitError;
