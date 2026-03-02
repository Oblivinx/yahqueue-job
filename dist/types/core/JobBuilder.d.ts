import { Job, JobOptions } from './types.js';
export declare class JobBuilder<T = unknown> {
    private _payload;
    private _priority;
    private _maxRetries;
    private _timeout;
    private _delay;
    static from<T>(payload: T): JobBuilder<T>;
    fromOptions(options: JobOptions<T>): this;
    priority(val: number): this;
    maxRetries(val: number): this;
    timeout(val: number): this;
    delay(val: number): this;
    build(): Job<T>;
}
