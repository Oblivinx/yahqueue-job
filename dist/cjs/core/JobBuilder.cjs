"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobBuilder = void 0;
const nanoid_1 = require("nanoid");
class JobBuilder {
    _payload;
    _priority = 0;
    _maxRetries = 3;
    _timeout = 30000;
    _delay = 0;
    static from(payload) {
        const builder = new JobBuilder();
        builder._payload = payload;
        return builder;
    }
    fromOptions(options) {
        this._payload = options.payload;
        if (options.priority !== undefined)
            this._priority = options.priority;
        if (options.maxRetries !== undefined)
            this._maxRetries = options.maxRetries;
        if (options.timeout !== undefined)
            this._timeout = options.timeout;
        if (options.delay !== undefined)
            this._delay = options.delay;
        return this;
    }
    priority(val) {
        this._priority = val;
        return this;
    }
    maxRetries(val) {
        this._maxRetries = val;
        return this;
    }
    timeout(val) {
        this._timeout = val;
        return this;
    }
    delay(val) {
        this._delay = val;
        return this;
    }
    build() {
        const now = Date.now();
        return {
            id: (0, nanoid_1.nanoid)(),
            payload: this._payload,
            priority: this._priority,
            maxRetries: this._maxRetries,
            attempts: 0,
            timeout: this._timeout,
            status: (this._delay > 0 ? 'delayed' : 'pending'),
            createdAt: now,
            runAt: now + this._delay,
        };
    }
}
exports.JobBuilder = JobBuilder;
