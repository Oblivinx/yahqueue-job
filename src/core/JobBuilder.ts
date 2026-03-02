import { nanoid } from 'nanoid';
import { Job, JobOptions, JobStatus } from './types.js';

export class JobBuilder<T = unknown> {
    private _payload!: T;
    private _priority: number = 0;
    private _maxRetries: number = 3;
    private _timeout: number = 30000;
    private _delay: number = 0;

    static from<T>(payload: T): JobBuilder<T> {
        const builder = new JobBuilder<T>();
        builder._payload = payload;
        return builder;
    }

    fromOptions(options: JobOptions<T>): this {
        this._payload = options.payload;
        if (options.priority !== undefined) this._priority = options.priority;
        if (options.maxRetries !== undefined) this._maxRetries = options.maxRetries;
        if (options.timeout !== undefined) this._timeout = options.timeout;
        if (options.delay !== undefined) this._delay = options.delay;
        return this;
    }

    priority(val: number): this {
        this._priority = val;
        return this;
    }

    maxRetries(val: number): this {
        this._maxRetries = val;
        return this;
    }

    timeout(val: number): this {
        this._timeout = val;
        return this;
    }

    delay(val: number): this {
        this._delay = val;
        return this;
    }

    build(): Job<T> {
        const now = Date.now();
        return {
            id: nanoid(),
            payload: this._payload,
            priority: this._priority,
            maxRetries: this._maxRetries,
            attempts: 0,
            timeout: this._timeout,
            status: (this._delay > 0 ? 'delayed' : 'pending') as JobStatus,
            createdAt: now,
            runAt: now + this._delay,
        };
    }
}
