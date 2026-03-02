/** Default logger backed by console — zero external dependencies */
export class ConsoleLogger {
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
/** Null logger — discards all output. Useful for production opt-out. */
export class NullLogger {
    debug(_message, ..._args) { }
    info(_message, ..._args) { }
    warn(_message, ..._args) { }
    error(_message, ..._args) { }
}
/** Singleton default logger */
export const defaultLogger = new ConsoleLogger();
