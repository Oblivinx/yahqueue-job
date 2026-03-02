import { createJob, updateJob } from '../job/Job.js';
import { JobState } from '../job/JobState.js';
import { JobResultFactory } from '../job/JobResult.js';
import { JobRegistry } from './JobRegistry.js';
import { Scheduler } from './Scheduler.js';
import { FlowController } from './FlowController.js';
import { TypedEventEmitter } from '../events/EventEmitter.js';
import { QueueEvent } from '../events/QueueEvents.js';
import { ExponentialBackoff } from '../retry/ExponentialBackoff.js';
import { WALWriter } from '../persistence/WALWriter.js';
import { Snapshot } from '../persistence/Snapshot.js';
import { Recovery } from '../persistence/Recovery.js';
import { validateConfig } from '../config/validateConfig.js';
import { resolveConfig } from '../config/QueueConfig.js';
import { AdapterError } from '../errors/AdapterError.js';
import { QueueError } from '../errors/QueueError.js';
import { JobTimeoutError } from '../errors/JobTimeoutError.js';
import { DiscardJobError } from '../errors/DiscardJobError.js';
import { Metrics } from '../plugins/Metrics.js';
import { DeadLetterQueue } from '../plugins/DeadLetterQueue.js';
import { JobTTL } from '../plugins/JobTTL.js';
import { systemClock } from '../utils/clock.js';
import { sleep } from '../utils/sleep.js';
/**
 * JobQueue — the main orchestrator.
 *
 * @example
 * const queue = new JobQueue({ name: 'main', workers: { min: 1, max: 5 } });
 * queue.register('sendMessage', async (payload, ctx) => { ... });
 * await queue.initialize();
 * const id = await queue.enqueue({ type: 'sendMessage', payload: { ... } });
 */
export class JobQueue {
    cfg;
    registry = new JobRegistry();
    scheduler;
    flowController;
    emitter = new TypedEventEmitter();
    wal;
    snapshot;
    recovery;
    defaultRetry;
    activeWorkers = 0;
    isClosed = false;
    isPaused = false;
    drainResolvers = [];
    workers = new Set();
    constructor(config) {
        validateConfig(config);
        this.cfg = resolveConfig(config);
        this.scheduler = new Scheduler(systemClock);
        this.flowController = new FlowController(this.cfg.adapter);
        this.defaultRetry = new ExponentialBackoff({
            maxAttempts: this.cfg.defaultMaxAttempts,
        });
        this.wal = new WALWriter(this.cfg.persistence.walPath, this.cfg.persistence.enabled);
        this.snapshot = new Snapshot(this.cfg.persistence.snapshotPath, this.cfg.adapter);
        this.recovery = new Recovery(this.wal, this.snapshot, this.cfg.adapter);
        // Wire JobTTL expire callback
        const ttlPlugin = this.cfg.plugins.find((p) => p instanceof JobTTL);
        if (ttlPlugin) {
            ttlPlugin.onExpireCallback((job) => {
                this.handleExpire(job).catch((err) => {
                    this.emitter.emit(QueueEvent.ERROR, err instanceof Error ? err : new QueueError(String(err)));
                });
            });
        }
        // Wire DLQ enqueue callback
        const dlqPlugin = this.cfg.plugins.find((p) => p instanceof DeadLetterQueue);
        if (dlqPlugin) {
            dlqPlugin.setEnqueueCallback(async (job) => {
                await this.cfg.adapter.push(job);
            });
        }
        // Scheduler triggers delayed jobs back into the heap
        this.scheduler.onReady((job) => {
            this.cfg.adapter.push(job).then(() => {
                this.triggerWorker();
            }).catch((err) => {
                this.emitter.emit(QueueEvent.ERROR, err instanceof Error ? err : new AdapterError('Scheduler push failed', err));
            });
        });
    }
    // ─── Typed event methods ──────────────────────────────────────────────────────
    on(event, listener) {
        this.emitter.on(event, listener);
        return this;
    }
    once(event, listener) {
        this.emitter.once(event, listener);
        return this;
    }
    off(event, listener) {
        this.emitter.off(event, listener);
        return this;
    }
    // ─── Lifecycle ────────────────────────────────────────────────────────────────
    /**
     * Initialize the queue: run WAL recovery if persistence is enabled, start workers.
     */
    async initialize() {
        if (this.cfg.persistence.enabled) {
            this.wal.initialize();
            await this.recovery.run();
            this.snapshot.schedule(this.cfg.persistence.snapshotIntervalMs, () => this.wal.currentSeq);
        }
        this.startWorkers();
    }
    /** Register a job handler for a given type */
    register(type, handler) {
        this.registry.register(type, handler);
    }
    /**
     * Enqueue a job.
     * @returns The job ID
     * @throws QueueError if queue is closed
     */
    async enqueue(options) {
        this.checkOpen();
        const job = createJob(options, {
            defaultPriority: this.cfg.defaultPriority,
            defaultMaxAttempts: this.cfg.defaultMaxAttempts,
            defaultMaxDuration: this.cfg.defaultMaxDuration,
        });
        // Run onEnqueue plugin hooks (serial, stop on error)
        for (const plugin of this.cfg.plugins) {
            if (plugin.onEnqueue)
                await plugin.onEnqueue(job);
        }
        if (job.runAt > systemClock.now()) {
            // Delayed job: go through scheduler
            this.scheduler.schedule(job, job.runAt);
        }
        else {
            await this.cfg.adapter.push(job);
            if (this.cfg.persistence.enabled) {
                this.wal.append('ENQUEUE', job.id, job);
            }
            this.triggerWorker();
        }
        this.emitter.emit(QueueEvent.ENQUEUED, job);
        return job.id;
    }
    /** Enqueue a linear chain of jobs (A → B → C) */
    async flow(steps) {
        this.checkOpen();
        return this.flowController.chain(steps);
    }
    /** Enqueue a DAG of jobs with dependencies */
    async dag(config) {
        this.checkOpen();
        return this.flowController.dag(config);
    }
    /** Pause processing — in-flight jobs finish, new ones are not started */
    pause() {
        this.isPaused = true;
    }
    /** Resume processing after a pause */
    resume() {
        this.isPaused = false;
        this.triggerWorker();
    }
    /**
     * Drain: wait until all currently pending AND active jobs complete.
     */
    async drain() {
        const size = await this.cfg.adapter.size();
        if (size === 0 && this.activeWorkers === 0)
            return;
        return new Promise((resolve) => {
            this.drainResolvers.push(resolve);
        });
    }
    /**
     * Gracefully shut down all workers.
     * Waits for in-flight jobs to complete.
     */
    async shutdown() {
        this.isClosed = true;
        this.scheduler.clear();
        this.snapshot.stop();
        await Promise.all(this.workers);
        await this.cfg.adapter.close();
        // Clear JobTTL timers
        const ttlPlugin = this.cfg.plugins.find((p) => p instanceof JobTTL);
        ttlPlugin?.clear();
        this.emitter.removeAllListeners();
    }
    /** Get the current number of pending jobs */
    async size() {
        return this.cfg.adapter.size();
    }
    /** Clear all pending jobs */
    async clear() {
        await this.cfg.adapter.clear();
    }
    /**
     * Run a job handler directly in-process, bypassing the queue entirely.
     *
     * Useful for:
     *  - Testing handlers without queue overhead
     *  - Urgent/synchronous one-off executions
     *  - Running jobs in contexts where queue workers are not started
     *
     * Plugin hooks (`onEnqueue`, `onProcess`, `onComplete`, `onFail`) are still
     * invoked so metrics, rate-limiters, and other plugins remain accurate.
     *
     * @returns The handler's return value on success
     * @throws The original handler error on failure (no retries)
     *
     * @example
     * const result = await queue.runInProcess('sendEmail', { to: 'a@b.com' });
     */
    async runInProcess(type, payload, options) {
        this.checkOpen();
        const job = createJob({ type, payload, ...options }, {
            defaultPriority: this.cfg.defaultPriority,
            defaultMaxAttempts: this.cfg.defaultMaxAttempts,
            defaultMaxDuration: this.cfg.defaultMaxDuration,
        });
        // onEnqueue hooks (rate-limiter, deduplicator, etc.)
        for (const plugin of this.cfg.plugins) {
            if (plugin.onEnqueue)
                await plugin.onEnqueue(job);
        }
        // onProcess hooks
        for (const plugin of this.cfg.plugins) {
            if (plugin.onProcess)
                await plugin.onProcess(job);
        }
        const handler = this.registry.lookup(type);
        const ctx = { jobId: job.id, attempt: 1 };
        let handlerResult;
        try {
            let timeoutId;
            const maxDuration = options?.maxDuration ?? this.cfg.defaultMaxDuration;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new JobTimeoutError(job.id, maxDuration)), maxDuration);
            });
            handlerResult = await Promise.race([
                handler(job.payload, ctx),
                timeoutPromise,
            ]).finally(() => clearTimeout(timeoutId));
        }
        catch (err) {
            const error = err instanceof Error ? err : new QueueError(String(err));
            const result = JobResultFactory.failure(error);
            const failedJob = updateJob(job, {
                state: JobState.FAILED,
                attempts: 1,
                lastError: error.message,
                finishedAt: systemClock.now(),
            });
            for (const plugin of this.cfg.plugins) {
                if (plugin.onFail)
                    await plugin.onFail(failedJob, error);
            }
            this.emitter.emit(QueueEvent.FAILED, failedJob, error);
            throw err;
        }
        const result = JobResultFactory.success(handlerResult);
        const doneJob = updateJob(job, {
            state: JobState.DONE,
            attempts: 1,
            finishedAt: systemClock.now(),
        });
        for (const plugin of this.cfg.plugins) {
            if (plugin.onComplete)
                await plugin.onComplete(doneJob, result);
        }
        this.emitter.emit(QueueEvent.COMPLETED, doneJob, result);
        return handlerResult;
    }
    /** Get metrics snapshot */
    get metrics() {
        const metricsPlugin = this.cfg.plugins.find((p) => p instanceof Metrics);
        return {
            snapshot: (depth) => {
                if (metricsPlugin)
                    return metricsPlugin.snapshot(depth);
                return {
                    processed: 0,
                    failed: 0,
                    retried: 0,
                    expired: 0,
                    depth: depth ?? 0,
                    avgLatencyMs: 0,
                    activeWorkers: this.activeWorkers,
                };
            },
        };
    }
    /** Get the DeadLetterQueue plugin if configured */
    get dlq() {
        const plugin = this.cfg.plugins.find((p) => p instanceof DeadLetterQueue);
        if (!plugin)
            throw new QueueError('DeadLetterQueue plugin is not configured');
        return plugin;
    }
    // ─── Worker pool ──────────────────────────────────────────────────────────────
    startWorkers() {
        for (let i = 0; i < this.cfg.workers.min; i++) {
            this.spawnWorker();
        }
    }
    spawnWorker() {
        const workerLoop = this.runWorkerLoop();
        this.workers.add(workerLoop);
        workerLoop.finally(() => this.workers.delete(workerLoop));
    }
    triggerWorker() {
        if (this.isClosed || this.isPaused)
            return;
        if (this.activeWorkers < this.cfg.workers.max) {
            this.spawnWorker();
        }
    }
    async runWorkerLoop() {
        while (!this.isClosed) {
            if (this.isPaused) {
                await sleep(50);
                continue;
            }
            const processed = await this.processNext();
            if (!processed) {
                // No job available — exit this worker loop instance
                break;
            }
        }
        this.checkDrain();
    }
    async processNext() {
        let job = null;
        try {
            job = await this.cfg.adapter.pop();
        }
        catch (err) {
            this.emitter.emit(QueueEvent.ERROR, new AdapterError('Failed to pop job', err));
            return false;
        }
        if (!job)
            return false;
        // Run onProcess plugin hooks
        try {
            for (const plugin of this.cfg.plugins) {
                if (plugin.onProcess)
                    await plugin.onProcess(job);
            }
        }
        catch (err) {
            if (DiscardJobError.is(err)) {
                // Plugin requested silent discard — drop job, do NOT re-queue
                return false;
            }
            // Any other error (e.g. Throttle exceeded) — put back and retry later
            await this.cfg.adapter.push(job).catch(() => { });
            return false;
        }
        this.activeWorkers += 1;
        const activeJob = updateJob(job, { state: JobState.ACTIVE, startedAt: systemClock.now() });
        await this.cfg.adapter.update(activeJob).catch(() => { });
        if (this.cfg.persistence.enabled) {
            this.wal.append('ACTIVATE', activeJob.id);
        }
        this.emitter.emit(QueueEvent.ACTIVE, activeJob);
        await this.executeJob(activeJob);
        this.activeWorkers = Math.max(0, this.activeWorkers - 1);
        return true;
    }
    async executeJob(job) {
        const handler = this.registry.lookup(job.type);
        const ctx = { jobId: job.id, attempt: job.attempts + 1 };
        let result;
        try {
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new JobTimeoutError(job.id, job.maxDuration)), job.maxDuration);
            });
            // peek guarantees timeoutId is assigned before Promise.race
            const handlerResult = await Promise.race([
                handler(job.payload, ctx),
                timeoutPromise,
            ]).finally(() => clearTimeout(timeoutId));
            result = JobResultFactory.success(handlerResult);
        }
        catch (err) {
            const error = err instanceof Error ? err : new QueueError(String(err));
            result = JobResultFactory.failure(error);
        }
        if (result.ok) {
            await this.onSuccess(job, result);
        }
        else {
            await this.onFailure(job, result.error);
        }
    }
    async onSuccess(job, result) {
        const doneJob = updateJob(job, {
            state: JobState.DONE,
            finishedAt: systemClock.now(),
            attempts: job.attempts + 1,
        });
        await this.cfg.adapter.update(doneJob).catch(() => { });
        if (this.cfg.persistence.enabled) {
            this.wal.append('COMPLETE', doneJob.id, result);
        }
        for (const plugin of this.cfg.plugins) {
            if (plugin.onComplete)
                await plugin.onComplete(doneJob, result);
        }
        await this.flowController.onJobComplete(doneJob);
        this.emitter.emit(QueueEvent.COMPLETED, doneJob, result);
        this.triggerWorker();
    }
    async onFailure(job, error) {
        const attempts = job.attempts + 1;
        // Per-job retry policy takes precedence over the queue-level default
        const retryPolicy = job.retryPolicy ?? this.defaultRetry;
        if (attempts < job.maxAttempts && retryPolicy.shouldRetry(attempts, error)) {
            const delay = retryPolicy.nextDelay(attempts, error);
            const retryJob = updateJob(job, {
                state: JobState.RETRYING,
                attempts,
                lastError: error.message,
                runAt: systemClock.now() + delay,
            });
            if (delay > 0) {
                this.scheduler.schedule(retryJob, retryJob.runAt);
            }
            else {
                await this.cfg.adapter.push(retryJob);
            }
            if (this.cfg.persistence.enabled) {
                this.wal.append('RETRY', retryJob.id);
            }
            const metricsPlugin = this.cfg.plugins.find((p) => p instanceof Metrics);
            metricsPlugin?.recordRetry();
            this.emitter.emit(QueueEvent.RETRYING, retryJob, attempts);
        }
        else {
            // Permanent failure
            const failedJob = updateJob(job, {
                state: JobState.FAILED,
                attempts,
                lastError: error.message,
                finishedAt: systemClock.now(),
            });
            await this.cfg.adapter.update(failedJob).catch(() => { });
            if (this.cfg.persistence.enabled) {
                this.wal.append('FAIL', failedJob.id);
            }
            for (const plugin of this.cfg.plugins) {
                if (plugin.onFail)
                    await plugin.onFail(failedJob, error);
            }
            this.flowController.onJobFail(failedJob);
            this.emitter.emit(QueueEvent.DEAD_LETTER, failedJob, error);
            this.emitter.emit(QueueEvent.FAILED, failedJob, error);
        }
        this.triggerWorker();
    }
    async handleExpire(job) {
        const expired = updateJob(job, { state: JobState.EXPIRED });
        await this.cfg.adapter.remove(job.id).catch(() => { });
        if (this.cfg.persistence.enabled) {
            this.wal.append('EXPIRE', job.id);
        }
        for (const plugin of this.cfg.plugins) {
            if (plugin.onExpire)
                await plugin.onExpire(expired);
        }
        this.emitter.emit(QueueEvent.EXPIRED, expired);
    }
    checkOpen() {
        if (this.isClosed)
            throw new QueueError('JobQueue is closed');
    }
    checkDrain() {
        if (this.activeWorkers === 0) {
            this.cfg.adapter.size().then((size) => {
                if (size === 0) {
                    for (const resolve of this.drainResolvers)
                        resolve();
                    this.drainResolvers = [];
                }
            }).catch(() => { });
        }
    }
    // Keep imports alive
    static _imports = { sleep, AdapterError, QueueError, JobTimeoutError, DiscardJobError };
}
