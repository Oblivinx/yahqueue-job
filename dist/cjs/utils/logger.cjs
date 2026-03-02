"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultLogger = exports.NullLogger = exports.ConsoleLogger = void 0;
/** Default logger backed by console — zero external dependencies */
class ConsoleLogger {
    prefix;
    constructor(prefix = '[wa-job-queue]') {
        this.prefix = prefix;
    }
    debug(message, ...args) {
        console.debug(`${this.prefix} ${message}`, ...args);
    }
    info(message, ...args) {
        console.info(`${this.prefix} ${message}`, ...args);
    }
    warn(message, ...args) {
        console.warn(`${this.prefix} ${message}`, ...args);
    }
    error(message, ...args) {
        console.error(`${this.prefix} ${message}`, ...args);
    }
}
exports.ConsoleLogger = ConsoleLogger;
/** Null logger — discards all output. Useful for production opt-out. */
class NullLogger {
    debug(_message, ..._args) { }
    info(_message, ..._args) { }
    warn(_message, ..._args) { }
    error(_message, ..._args) { }
}
exports.NullLogger = NullLogger;
/** Singleton default logger */
exports.defaultLogger = new ConsoleLogger();
