<div align="center">
  <img height="1000" src="https://i.pinimg.com/736x/0c/a5/38/0ca5385762a719d9b78df1cef92f6a5f.jpg"  />
</div>

# wa-job-queue

> **Enterprise-grade, framework-agnostic Job Queue for Node.js — No Redis required.**

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`wa-job-queue` is a highly-scalable, multi-process-ready job queue built for demanding Node.js applications. It requires zero infrastructure — no Redis, no Kafka, no external broker. It ships with a full plugin ecosystem, flexible retry policies, built-in crash recovery, and a first-class multi-process sharding architecture designed for running hundreds of independent bots or workers in parallel.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [JobQueue](#jobqueue)
  - [Storage Adapters](#storage-adapters)
  - [Job Lifecycle](#job-lifecycle)
  - [JobBuilder](#jobbuilder)
- [Configuration Reference](#configuration-reference)
- [Plugins](#plugins)
  - [RateLimiter](#ratelimiter)
  - [Throttle](#throttle)
  - [Deduplicator](#deduplicator)
  - [Debounce](#debounce)
  - [JobTTL](#jobttl)
  - [DeadLetterQueue](#deadletterqueue)
  - [Metrics](#metrics)
- [Retry Policies](#retry-policies)
  - [ExponentialBackoff](#exponentialbackoff)
  - [LinearBackoff](#linearbackoff)
  - [NoRetry](#noretry)
  - [CustomRetry](#customretry)
- [Flow Control](#flow-control)
  - [Chains (A → B → C)](#chains)
  - [DAG (Directed Acyclic Graphs)](#dag)
- [Multi-Process Sharding (IPC)](#multi-process-sharding-ipc)
  - [IpcRouter (Main Process)](#ipcrouter-main-process)
  - [IpcWorker (Child Process)](#ipcworker-child-process)
  - [Benchmark Script](#benchmark-script)
- [Events](#events)
- [Persistence & Crash Recovery](#persistence--crash-recovery)
- [Utilities](#utilities)
  - [CircuitBreaker](#circuitbreaker)
  - [Logger](#logger)
- [Error Reference](#error-reference)
- [TypeScript Types Reference](#typescript-types-reference)
- [API Reference](#api-reference)

---

## Features

| Feature | Description |
|---|---|
| 🚫 **No Redis Required** | Uses `better-sqlite3` (optional) or in-memory heap — zero infra cost |
| ⚡ **Priority Queue** | O(log n) binary heap — higher-priority jobs always run first |
| 🔀 **Multi-Process Sharding** | Built-in `IpcRouter` + `IpcWorker` for routing jobs to child processes |
| 🔌 **Plugin Ecosystem** | `RateLimiter`, `Throttle`, `Deduplicator`, `Debounce`, `JobTTL`, `DeadLetterQueue`, `Metrics` |
| 🔁 **Retry Policies** | `ExponentialBackoff`, `LinearBackoff`, `CustomRetry`, `NoRetry` |
| 🔗 **Flow Control** | Sequential Chains and complex DAGs with dependency resolution |
| 💾 **Crash Recovery** | WAL + Snapshot persistence, auto-recovered on restart |
| 🔒 **100% TypeScript** | Full generic type safety from enqueue to handler |
| 📈 **Auto-Scaling Workers** | Worker pool scales up/down based on queue depth |
| ⚡ **Backpressure** | Per-shard IPC concurrency limiting prevents channel flooding |

---

## Installation

```bash
npm install wa-job-queue
```

**Optional:** Install `better-sqlite3` if you need SQLite persistence and crash recovery:

```bash
npm install better-sqlite3
```

**Requirements:** Node.js `>= 18.0.0`

---

## Quick Start

```typescript
import { JobQueue } from 'wa-job-queue';

// 1. Create a queue (in-memory by default)
const queue = new JobQueue({ name: 'main' });

// 2. Register a handler for a job type
queue.register('send-email', async (payload, ctx) => {
    console.log(`[attempt ${ctx.attempt}] Sending email to ${payload.to}`);
    await sendEmail(payload);
    return { sent: true };
});

// 3. Initialize (runs recovery, starts workers)
await queue.initialize();

// 4. Enqueue a job
const jobId = await queue.enqueue({
    type: 'send-email',
    payload: { to: 'user@example.com', subject: 'Hello' },
});

console.log('Enqueued job:', jobId);
```

---

## Core Concepts

### JobQueue

`JobQueue` is the main orchestrator. It manages the worker pool, plugin lifecycle, retry logic, and persistence.

```typescript
import { JobQueue, MemoryAdapter } from 'wa-job-queue';

const queue = new JobQueue({
    name: 'my-queue',
    adapter: new MemoryAdapter(),
    workers: { min: 2, max: 10 },
    defaultMaxAttempts: 3,
    defaultMaxDuration: 30_000, // ms
    defaultPriority: 5,
});

queue.register('my-job', async (payload, ctx) => {
    // payload: the job's data
    // ctx.jobId: unique job ID
    // ctx.attempt: current attempt number (starts at 1)
    // ctx.signal: AbortSignal — check for cancellation
    if (ctx.signal?.aborted) throw new Error('Cancelled');
    return 'result';
});

await queue.initialize();

// Lifecycle
queue.pause();           // stop picking up new jobs
queue.resume();          // resume processing
await queue.drain();     // wait for all active jobs to finish
await queue.shutdown();  // graceful shutdown
```

### Storage Adapters

Three built-in adapters are available. All implement `IStorageAdapter`.

#### MemoryAdapter (default)

Zero dependencies. Jobs are lost on process restart. Best for development and testing.

```typescript
import { MemoryAdapter } from 'wa-job-queue';

const adapter = new MemoryAdapter();
const queue = new JobQueue({ name: 'q', adapter });
```

#### SqliteAdapter

Persistent storage using `better-sqlite3` with WAL mode. Requires `npm install better-sqlite3`.

```typescript
import { SqliteAdapter } from 'wa-job-queue';

const adapter = new SqliteAdapter({ path: './jobs.db' });
await adapter.initialize(); // must be called before use

const queue = new JobQueue({ name: 'q', adapter });
```

> Each bot/worker should use a **separate database file** to avoid `SQLITE_BUSY` (lock contention) errors.

#### FileAdapter

JSON flat-file adapter. Suitable for development, CLIs, and low-concurrency use cases.

```typescript
import { FileAdapter } from 'wa-job-queue';

const adapter = new FileAdapter({ filePath: './jobs.json' });
await adapter.initialize();

const queue = new JobQueue({ name: 'q', adapter });
```

> ⚠️ **Not recommended for high-concurrency production use.**

### Job Lifecycle

Every job progresses through these states:

```
pending → active → done
                 ↘ failed → retrying → active (if retry available)
                          ↘ dlq (if maxAttempts exhausted + DLQ plugin)
pending → expired (if TTL exceeded before processing)
```

| State | Meaning |
|---|---|
| `pending` | Waiting in queue, not yet picked up |
| `active` | Currently being processed by a worker |
| `done` | Completed successfully |
| `failed` | Failed, may retry |
| `retrying` | Scheduled for a retry attempt |
| `expired` | TTL elapsed before job was processed |
| `dlq` | Moved to Dead Letter Queue after exhausting retries |
| `paused` | Paused by flow dependency resolution |

### JobBuilder

Fluent API for creating jobs with all options:

```typescript
import { JobBuilder, ExponentialBackoff } from 'wa-job-queue';

const job = new JobBuilder<{ userId: string }>()
    .type('process-user')
    .payload({ userId: 'abc-123' })
    .priority(3)               // 1 = highest, 10 = lowest
    .delay(5_000)              // wait 5s before becoming eligible
    .maxAttempts(5)
    .maxDuration(10_000)       // job timeout in ms
    .ttl(60_000)               // expire if not started within 60s
    .retry(new ExponentialBackoff({ maxAttempts: 5 }))
    .build();

const jobId = await queue.enqueue(job);
```

Or use the inline options form directly in `enqueue()`:

```typescript
const jobId = await queue.enqueue({
    type: 'process-user',
    payload: { userId: 'abc-123' },
    priority: 3,
    delay: 5_000,
    maxAttempts: 5,
    maxDuration: 10_000,
    ttl: 60_000,
    retryPolicy: new ExponentialBackoff({ maxAttempts: 5 }),
});
```

---

## Configuration Reference

```typescript
interface QueueConfig {
    /** Required: unique queue name */
    name: string;

    /** Storage adapter. Default: MemoryAdapter */
    adapter?: IStorageAdapter;

    /** Worker pool configuration */
    workers?: {
        min?: number;               // Default: 1
        max?: number;               // Default: 10
        scaleUpThreshold?: number;  // Queue depth to trigger scale-up. Default: 5
        scaleDownThreshold?: number;// Queue depth to trigger scale-down. Default: 2
        scaleUpStep?: number;       // Workers to add per scale event. Default: 2
        monitorIntervalMs?: number; // Scaling check interval. Default: 1000
    };

    /** Persistence / WAL crash-recovery */
    persistence?: {
        enabled?: boolean;              // Default: false
        walPath?: string;               // Default: './wa-queue.wal'
        snapshotPath?: string;          // Default: './wa-queue.snapshot.json'
        snapshotIntervalMs?: number;    // Default: 60_000
    };

    /** Plugins to activate */
    plugins?: IPlugin[];

    /** Defaults applied to all jobs unless overridden */
    defaultPriority?: number;       // Default: 5
    defaultMaxAttempts?: number;    // Default: 3
    defaultMaxDuration?: number;    // Default: 30_000 (ms)
}
```

---

## Plugins

Plugins hook into the job lifecycle. Pass them in `plugins: [...]` when creating the queue.

### RateLimiter

Token-bucket rate limiting per job type (or custom key). Throws `RateLimitError` when limit is exceeded.

```typescript
import { RateLimiter } from 'wa-job-queue';

new RateLimiter({
    limit: 10,          // max 10 jobs
    windowMs: 1_000,    // per 1 second window

    // Optional: custom key function (default: job.type)
    keyFn: (job) => job.payload.userId as string,
})
```

| Option | Type | Description |
|---|---|---|
| `limit` | `number` | Max jobs allowed per window |
| `windowMs` | `number` | Window duration in milliseconds |
| `keyFn` | `(job) => string` | Key extractor — defaults to `job.type` |

### Throttle

Hard global concurrency cap. Throws `RateLimitError` when `maxConcurrent` active jobs are reached.

```typescript
import { Throttle } from 'wa-job-queue';

new Throttle({ maxConcurrent: 5 })
```

> **Throttle vs RateLimiter:** Throttle limits *simultaneous* active jobs. RateLimiter limits *requests per time window*.

### Deduplicator

Prevents duplicate job IDs from entering the queue. The ID is released after the job completes or fails (allowing re-enqueue).

```typescript
import { Deduplicator } from 'wa-job-queue';

const dedup = new Deduplicator();

// Access current size
console.log(dedup.size); // number of tracked active jobs
```

To trigger deduplication, enqueue jobs with an explicit deterministic ID:

```typescript
import { createJob } from 'wa-job-queue';

const job = createJob({ type: 'sync', payload: { userId: '42' } });
// job.id is auto-generated (ULID). For dedup, generate a stable ID:
const stableId = `sync-${userId}`;
```

### Debounce

Last-write-wins per debounce key. When multiple jobs share the same key within `windowMs`, only the **last** one runs — earlier ones are silently discarded.

```typescript
import { Debounce } from 'wa-job-queue';

new Debounce({
    windowMs: 500,  // 500ms debounce window

    // Optional: key extractor (default: job.type)
    keyFn: (job) => `${job.type}:${job.payload.userId}`,
})
```

```typescript
// Only the last enqueue within 500ms will actually run:
await queue.enqueue({ type: 'sync-user', payload: { userId: '42' } });
await queue.enqueue({ type: 'sync-user', payload: { userId: '42' } }); // ← this one wins
```

### JobTTL

Auto-expires jobs that remain pending beyond a configured TTL. Emits `expired` event.

```typescript
import { JobTTL } from 'wa-job-queue';

const queue = new JobQueue({
    name: 'q',
    plugins: [new JobTTL()],
});

// Set TTL per-job at enqueue time:
await queue.enqueue({
    type: 'critical-task',
    payload: { ... },
    ttl: 30_000, // expire if not started within 30 seconds
});
```

Listen for expirations:

```typescript
queue.on('expired', (job) => {
    console.log(`Job ${job.id} expired after ${job.ttl}ms`);
});
```

### DeadLetterQueue

Captures permanently failed jobs (exhausted all retry attempts). Provides inspect, retry, and purge APIs.

```typescript
import { DeadLetterQueue } from 'wa-job-queue';

const dlq = new DeadLetterQueue();

const queue = new JobQueue({
    name: 'q',
    plugins: [dlq],
});

// Listen for jobs entering DLQ
queue.on('dead-letter', (job, error) => {
    console.error(`Job ${job.id} permanently failed:`, error.message);
});

// --- DLQ Management API ---

dlq.list();              // DLQEntry[] — all captured entries
dlq.get(jobId);          // DLQEntry | undefined
dlq.has(jobId);          // boolean
dlq.size;                // number of entries

await dlq.retry(jobId);  // re-enqueue job back into the queue
dlq.delete(jobId);       // remove entry without re-enqueuing
dlq.purge();             // clear all DLQ entries
```

### Metrics

Tracks processing stats and latency. Access via `metrics.snapshot()`.

```typescript
import { Metrics } from 'wa-job-queue';

const metrics = new Metrics();

const queue = new JobQueue({
    name: 'q',
    plugins: [metrics],
});

// Get a snapshot of current stats
const snap = metrics.snapshot(await adapter.size());
// {
//   processed: 1402,
//   failed: 3,
//   retried: 8,
//   expired: 1,
//   depth: 47,          // current queue depth (injected)
//   avgLatencyMs: 124,
//   activeWorkers: 5,
// }

metrics.reset(); // reset all counters
```

---

## Retry Policies

All retry policies implement `IRetryPolicy`. The queue-level default is `ExponentialBackoff`. Override per-job using `retryPolicy`.

### ExponentialBackoff

Exponential backoff with full jitter. Default retry policy.

```typescript
import { ExponentialBackoff } from 'wa-job-queue';

new ExponentialBackoff({
    maxAttempts: 5,     // total attempts including first
    base: 1_000,        // base delay in ms (default: 1000)
    cap: 60_000,        // max delay cap in ms (default: 60000)
})

// Delay formula: random(0, min(cap, base * 2^attempt))
// attempt 1 → 0–2s
// attempt 2 → 0–4s
// attempt 3 → 0–8s  ... capped at cap
```

### LinearBackoff

Fixed-interval delay between every retry attempt.

```typescript
import { LinearBackoff } from 'wa-job-queue';

new LinearBackoff({
    maxAttempts: 3,
    interval: 2_000, // wait 2s before each retry (default: 1000)
})
```

### NoRetry

Disables retries entirely. Job fails immediately on first error.

```typescript
import { NoRetry } from 'wa-job-queue';

new NoRetry()
```

### CustomRetry

Full control via a predicate and delay function.

```typescript
import { CustomRetry } from 'wa-job-queue';

new CustomRetry({
    // Retry only on transient errors, max 4 times
    predicate: (attempt, err) =>
        attempt < 4 && (err.message.includes('EAGAIN') || err.message.includes('timeout')),

    // Progressive delay: 500ms, 1000ms, 1500ms...
    delay: (attempt) => attempt * 500,
})
```

#### Per-job retry override

```typescript
await queue.enqueue({
    type: 'my-job',
    payload: { ... },
    retryPolicy: new LinearBackoff({ maxAttempts: 10, interval: 500 }),
});
```

---

## Flow Control

`FlowController` enables sequential Chains and complex DAGs. Both are managed internally by `JobQueue` — use the methods on the queue instance.

### Chains

Ordered sequence: job A runs, then B, then C. If any step fails, the chain is cancelled.

```typescript
const flowId = await queue.chain([
    { type: 'download-file',  payload: { url: 'https://...' } },
    { type: 'process-file',   payload: { format: 'mp4' } },
    { type: 'upload-result',  payload: { bucket: 'my-bucket' } },
]);

queue.on('flow:completed', (id) => {
    if (id === flowId) console.log('Pipeline complete!');
});

queue.on('flow:failed', (id, error) => {
    if (id === flowId) console.error('Pipeline failed:', error.message);
});
```

### DAG

Directed Acyclic Graph — jobs with explicit `dependsOn` edges. All dependencies must complete before a node starts.

```typescript
const flowId = await queue.dag({
    nodes: {
        'fetch-data': {
            type: 'fetch',
            payload: { source: 'api' },
        },
        'transform-a': {
            type: 'transform',
            payload: { mode: 'normalize' },
            dependsOn: ['fetch-data'],       // waits for fetch-data
        },
        'transform-b': {
            type: 'transform',
            payload: { mode: 'enrich' },
            dependsOn: ['fetch-data'],       // waits for fetch-data
        },
        'merge': {
            type: 'merge',
            payload: {},
            dependsOn: ['transform-a', 'transform-b'], // waits for both
        },
        'notify': {
            type: 'notify',
            payload: { channel: 'slack' },
            dependsOn: ['merge'],
        },
    },
});
```

```
fetch-data
    ├── transform-a ──┐
    └── transform-b ──┴── merge ── notify
```

> **Cycle detection:** The DAG engine uses Kahn's topological sort algorithm and throws `CyclicDependencyError` if a cycle is detected.

---

## Multi-Process Sharding (IPC)

For applications running many isolated workers (e.g. 120 WhatsApp bots), `wa-job-queue` provides a built-in sharding layer using Node.js `cluster` IPC.

**Architecture:**

```
MAIN PROCESS
  └── IpcRouter
        ├── registerShard('bot-001', childProcess1) ──→ WORKER PROCESS 1 (IpcWorker + JobQueue)
        ├── registerShard('bot-002', childProcess2) ──→ WORKER PROCESS 2 (IpcWorker + JobQueue)
        └── registerShard('bot-N',   childProcessN) ──→ WORKER PROCESS N (IpcWorker + JobQueue)
```

Each child process owns its own `JobQueue` and (optionally) its own SQLite database, eliminating all lock contention.

### IpcRouter (Main Process)

```typescript
import { IpcRouter } from 'wa-job-queue';
import cluster from 'node:cluster';

const router = new IpcRouter({
    maxConcurrentPerShard: 64,  // max in-flight IPC requests per shard (default: 64)
    requestTimeoutMs: 10_000,   // IPC response timeout in ms (default: 10000)
});

// Register each worker process as a shard
const worker = cluster.fork({ SHARD_KEY: 'bot-001' });
router.registerShard('bot-001', worker.process);

// Enqueue a job — will be routed to the 'bot-001' shard
await router.enqueue({
    shardKey: 'bot-001',
    type: 'send-message',
    payload: { text: 'Hello!', to: '+628...' },
});

// Control all shards
router.pause();   // broadcast pause to all connected shards
router.resume();  // broadcast resume to all connected shards
await router.shutdown(); // graceful shutdown of all shards

// Explicit shard removal (e.g. after planned shutdown of a bot)
router.deregisterShard('bot-001');
```

#### IpcRouter Options

| Option | Type | Default | Description |
|---|---|---|---|
| `maxConcurrentPerShard` | `number` | `64` | Max in-flight IPC requests per shard. Excess requests are queued locally to prevent IPC channel flooding. |
| `requestTimeoutMs` | `number` | `10000` | Milliseconds before an unacknowledged IPC request is rejected with a timeout error. |

#### IpcRouter API

| Method | Returns | Description |
|---|---|---|
| `registerShard(key, child)` | `void` | Register a child process for a shard key |
| `deregisterShard(key)` | `void` | Deregister and reject all pending requests for this shard |
| `enqueue(options)` | `Promise<string>` | Route a job to the correct shard |
| `pause()` | `void` | Send pause to all connected shards |
| `resume()` | `void` | Send resume to all connected shards |
| `shutdown()` | `Promise<void>` | Gracefully shut down all shards |

### IpcWorker (Child Process)

```typescript
import { IpcWorker, JobQueue, SqliteAdapter } from 'wa-job-queue';

const shardKey = process.env.SHARD_KEY!; // e.g. 'bot-001'

// Each shard gets its own isolated database
const adapter = new SqliteAdapter({ path: `./jobs_${shardKey}.db` });
await adapter.initialize();

const queue = new JobQueue({
    name: `shard-${shardKey}`,
    adapter,
    workers: { min: 2, max: 4 },
});

queue.register('send-message', async (payload, ctx) => {
    // handle job...
});

await queue.initialize();

// Start listening for IPC commands from the main process
const worker = new IpcWorker(queue);
worker.start();

// Notify main process we're ready
process.send?.({ ready: true });
```

### Benchmark Script

A ready-to-run benchmark is included at `scripts/benchmark-sharded.mjs`:

```bash
node scripts/benchmark-sharded.mjs
```

It spawns up to 4 worker processes and routes 10,000 jobs with a configurable concurrency semaphore, measuring end-to-end throughput.

---

## Events

Listen to queue events using the standard `on` / `once` / `off` pattern:

```typescript
queue.on('enqueued',       (job) => { });
queue.on('active',         (job) => { });
queue.on('completed',      (job, result) => { });
queue.on('failed',         (job, error) => { });
queue.on('retrying',       (job, attempt) => { });
queue.on('expired',        (job) => { });
queue.on('dead-letter',    (job, error) => { });
queue.on('flow:completed', (flowId) => { });
queue.on('flow:failed',    (flowId, error) => { });
queue.on('worker:scaled-up',   (count) => { });
queue.on('worker:scaled-down', (count) => { });
queue.on('worker:error',       (error) => { });
queue.on('error',              (error) => { });
```

All event names are available as constants via `QueueEvent`:

```typescript
import { QueueEvent } from 'wa-job-queue';

queue.on(QueueEvent.COMPLETED, (job, result) => { /* ... */ });
queue.on(QueueEvent.DEAD_LETTER, (job, error) => { /* ... */ });
```

| Event | Payload | Fired when |
|---|---|---|
| `enqueued` | `(job)` | Job added to queue |
| `active` | `(job)` | Worker picks up a job |
| `completed` | `(job, result)` | Job handler returns successfully |
| `failed` | `(job, error)` | Job fails (may still retry) |
| `retrying` | `(job, attempt)` | Job scheduled for retry |
| `expired` | `(job)` | Job TTL elapsed |
| `dead-letter` | `(job, error)` | Job exhausted all retries |
| `flow:completed` | `(flowId)` | All jobs in a chain/DAG finished |
| `flow:failed` | `(flowId, error)` | A step in a chain/DAG failed |
| `worker:scaled-up` | `(count)` | Worker pool grew |
| `worker:scaled-down` | `(count)` | Worker pool shrank |
| `worker:error` | `(error)` | Unhandled worker error |
| `error` | `(error)` | General queue error |

---

## Persistence & Crash Recovery

Enable WAL-based persistence to survive process crashes:

```typescript
const queue = new JobQueue({
    name: 'prod-queue',
    adapter: new SqliteAdapter({ path: './jobs.db' }),
    persistence: {
        enabled: true,
        walPath: './prod-queue.wal',
        snapshotPath: './prod-queue.snapshot.json',
        snapshotIntervalMs: 30_000, // snapshot every 30s
    },
});

await queue.initialize(); // ← automatically replays WAL on startup
```

**How it works:**

1. Every `enqueue`, `complete`, and `fail` event is appended to the WAL file.
2. Periodically, a full snapshot is written to the snapshot file and the WAL is truncated.
3. On `initialize()`, the recovery module reads the snapshot (if present), then replays any WAL entries to reconstruct in-flight jobs.

> **Per-shard persistence:** In multi-process mode, each child process should use its own WAL/snapshot path and adapter path to avoid file lock conflicts.

---

## Utilities

### CircuitBreaker

Prevents cascading failures by blocking calls after consecutive errors.

```typescript
import { CircuitBreaker } from 'wa-job-queue';

const breaker = new CircuitBreaker({
    failureThreshold: 5,      // open after 5 consecutive failures
    recoveryTimeMs: 30_000,   // wait 30s before probing (HALF_OPEN)
});

try {
    const result = await breaker.execute(() => callExternalApi());
} catch (err) {
    if (err.message.includes('Circuit is OPEN')) {
        // fail fast, don't hit the external service
    }
}

breaker.currentState;   // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
breaker.isOpen;         // boolean shorthand
breaker.reset();        // manually reset to CLOSED
```

**State machine:**

```
CLOSED ──(N failures)──→ OPEN ──(recoveryTimeMs)──→ HALF_OPEN
  ↑                                                      │
  └──────────────── (probe success) ────────────────────┘
                     (probe failure) → OPEN
```

### Logger

Two built-in logger implementations. Inject via `ConsoleLogger` or `NullLogger`, or implement `ILogger`.

```typescript
import { ConsoleLogger, NullLogger, defaultLogger } from 'wa-job-queue';

// Enable console logging (stdout + stderr)
const logger = new ConsoleLogger();

// Silent logger (useful for tests)
const nullLogger = new NullLogger();
```

```typescript
// Implement your own:
import type { ILogger } from 'wa-job-queue';

class PinoLogger implements ILogger {
    info(msg: string, meta?: Record<string, unknown>) { pino.info(meta, msg); }
    warn(msg: string, meta?: Record<string, unknown>) { pino.warn(meta, msg); }
    error(msg: string, meta?: Record<string, unknown>) { pino.error(meta, msg); }
    debug(msg: string, meta?: Record<string, unknown>) { pino.debug(meta, msg); }
}
```

---

## Error Reference

All errors extend `QueueError` (which extends `Error`).

| Error Class | Thrown when |
|---|---|
| `QueueError` | Base error for all queue errors |
| `JobTimeoutError` | Job exceeded `maxDuration` |
| `AdapterError` | Storage adapter operation failed |
| `RateLimitError` | `RateLimiter` or `Throttle` limit exceeded |
| `DiscardJobError` | Plugin signals the job should be silently dropped (e.g. `Debounce`) |
| `DependencyError` | DAG dependency error (missing or failed dependency) |
| `CyclicDependencyError` | DAG contains a cycle |
| `UnknownJobTypeError` | No handler registered for job type |

```typescript
import {
    QueueError,
    JobTimeoutError,
    AdapterError,
    RateLimitError,
    DiscardJobError,
    DependencyError,
    CyclicDependencyError,
} from 'wa-job-queue';

queue.on('failed', (job, error) => {
    if (error instanceof JobTimeoutError) {
        // job ran too long
    } else if (error instanceof RateLimitError) {
        // rate limit or concurrency cap hit
    }
});
```

---

## TypeScript Types Reference

```typescript
import type {
    // Job types
    Job,
    JobPayload,
    JobOptions,
    JobResult,
    JobSuccess,
    JobFailure,
    JobContext,
    JobHandler,
    JobState,        // FSM states

    // Configuration
    QueueConfig,
    ResolvedQueueConfig,
    WorkerConfig,
    PersistenceConfig,
    MetricsSnapshot,

    // Adapter
    IStorageAdapter,

    // Plugin
    IPlugin,

    // Retry
    IRetryPolicy,

    // Flow
    FlowNode,
    DAGConfig,
    DAGNode,
    ChainStep,

    // Utility
    IClock,
    ILogger,

    // Plugin options
    RateLimiterOptions,
    ThrottleOptions,
    DebounceOptions,
} from 'wa-job-queue';
```

**Typed job handler:**

```typescript
interface SendMessagePayload {
    to: string;
    text: string;
}

interface SendMessageResult {
    messageId: string;
    sentAt: number;
}

const handler: JobHandler<SendMessagePayload, SendMessageResult> = async (payload, ctx) => {
    // payload is fully typed as SendMessagePayload
    return { messageId: generateId(), sentAt: Date.now() };
};

queue.register('send-message', handler);
```

---

## API Reference

### `JobQueue`

| Method | Signature | Description |
|---|---|---|
| `register` | `(type: string, handler: JobHandler) => void` | Register a handler for a job type |
| `initialize` | `() => Promise<void>` | Start recovery and workers |
| `enqueue` | `(options: JobOptions) => Promise<string>` | Add a job, returns job ID |
| `chain` | `(steps: ChainStep[]) => Promise<string>` | Create a sequential flow, returns flowId |
| `dag` | `(config: DAGConfig) => Promise<string>` | Create a DAG flow, returns flowId |
| `pause` | `() => void` | Pause processing |
| `resume` | `() => void` | Resume processing |
| `drain` | `() => Promise<void>` | Wait for all active jobs to complete |
| `shutdown` | `() => Promise<void>` | Graceful shutdown |
| `on` | `(event, listener) => this` | Subscribe to an event |
| `once` | `(event, listener) => this` | Subscribe once |
| `off` | `(event, listener) => this` | Unsubscribe |

### `IpcRouter`

| Method | Signature | Description |
|---|---|---|
| `registerShard` | `(key: string, child: ChildProcess) => void` | Register a worker process |
| `deregisterShard` | `(key: string) => void` | Remove a shard, reject pending requests |
| `enqueue` | `(options: JobOptions) => Promise<string>` | Route a job to the shard |
| `pause` | `() => void` | Broadcast pause to all shards |
| `resume` | `() => void` | Broadcast resume to all shards |
| `shutdown` | `() => Promise<void>` | Graceful shutdown all shards |

### `IpcWorker`

| Method | Signature | Description |
|---|---|---|
| `start` | `() => void` | Begin listening for IPC messages |

---

## License

[MIT](LICENSE)

---

*Built for WhatsApp automation at scale — but general enough for any multi-process Node.js job processing workload.*