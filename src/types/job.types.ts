/** FSM states for a Job lifecycle */
export type JobState =
    | 'pending'
    | 'active'
    | 'done'
    | 'failed'
    | 'retrying'
    | 'paused'
    | 'expired'
    | 'dlq';

/** Typed job payload — any serializable record */
export type JobPayload = Record<string, unknown>;

/** A single immutable job value object */
export interface Job<T extends JobPayload = JobPayload> {
    readonly id: string;
    readonly type: string;
    readonly payload: T;
    readonly priority: number;
    readonly maxAttempts: number;
    readonly attempts: number;
    readonly maxDuration: number;
    readonly state: JobState;
    readonly createdAt: number;
    readonly runAt: number;
    readonly ttl?: number;
    readonly expiresAt?: number;
    readonly startedAt?: number;
    readonly finishedAt?: number;
    readonly lastError?: string;
    readonly flowId?: string;
    readonly dependsOn?: string[];
}

/** Options passed to queue.enqueue() */
export interface JobOptions<T extends JobPayload = JobPayload> {
    type: string;
    payload: T;
    priority?: number;
    delay?: number;
    maxAttempts?: number;
    maxDuration?: number;
    ttl?: number;
    flowId?: string;
    dependsOn?: string[];
}

/** Result of a successful job */
export interface JobSuccess<R = unknown> {
    readonly ok: true;
    readonly value: R;
}

/** Result of a failed job */
export interface JobFailure {
    readonly ok: false;
    readonly error: Error;
}

/** Union result type */
export type JobResult<R = unknown> = JobSuccess<R> | JobFailure;

/** Context passed to job handler */
export interface JobContext {
    readonly jobId: string;
    readonly attempt: number;
    readonly signal?: AbortSignal;
}

/** Handler function registered per job type */
export type JobHandler<T extends JobPayload = JobPayload, R = unknown> = (
    payload: T,
    ctx: JobContext,
) => Promise<R>;
