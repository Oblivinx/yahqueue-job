/**
 * Logger interface — inject a custom logger (pino, winston, etc.)
 * or leave it as the default ConsoleLogger.
 */
export interface ILogger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

/** Default logger backed by console — zero external dependencies */
export class ConsoleLogger implements ILogger {
    private readonly prefix: string;

    constructor(prefix = '[wa-job-queue]') {
        this.prefix = prefix;
    }

    debug(message: string, ...args: unknown[]): void {
        console.debug(`${this.prefix} ${message}`, ...args);
    }

    info(message: string, ...args: unknown[]): void {
        console.info(`${this.prefix} ${message}`, ...args);
    }

    warn(message: string, ...args: unknown[]): void {
        console.warn(`${this.prefix} ${message}`, ...args);
    }

    error(message: string, ...args: unknown[]): void {
        console.error(`${this.prefix} ${message}`, ...args);
    }
}

/** Null logger — discards all output. Useful for production opt-out. */
export class NullLogger implements ILogger {
    debug(_message: string, ..._args: unknown[]): void { /* noop */ }
    info(_message: string, ..._args: unknown[]): void { /* noop */ }
    warn(_message: string, ..._args: unknown[]): void { /* noop */ }
    error(_message: string, ..._args: unknown[]): void { /* noop */ }
}

/** Singleton default logger */
export const defaultLogger: ILogger = new ConsoleLogger();
