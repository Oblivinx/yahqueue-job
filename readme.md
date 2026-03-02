# wa-job-queue

> Enterprise-grade, framework-agnostic Job Queue for Node.js — No Redis required.

`wa-job-queue` is a highly scalable, sharded, per-bot local queue architecture designed specifically for highly-concurrent, multi-process environments (such as running hundreds of independent WhatsApp bots). Instead of a centralized global queue that all worker processes poll from, the main process acts purely as a router, and each child process runs its own independent queue instance.

## 🌟 Key Features

- **No Redis Required:** Uses `better-sqlite3` (optional) and sharded persistence for zero filesystem lock contention.
- **Multi-Process Architecture:** Built-in `IpcRouter` and `IpcWorker` to natively handle routing jobs to child processes.
- **Rich Plugin Ecosystem:** `RateLimiter`, `Deduplicator`, `DeadLetterQueue`, `JobTTL`, `Debounce`, `Throttle`, and `Metrics`.
- **Advanced Retry Policies:** Includes `ExponentialBackoff`, `LinearBackoff`, and `CustomRetry`.
- **Flexible Flow Control:** Built-in support for job Chains and complex DAGs (Directed Acyclic Graphs).
- **Crash Recovery:** Jobs are safely persisted in SQLite Write-Ahead Logs (WAL) and automatically recovered upon respawn.
- **100% Type-Safe:** Fully written in TypeScript.

---

## 📦 Installation

```bash
npm install wa-job-queue
```

*(Optional)* If you plan to use the SQLite storage adapter for crash recovery and persistence across reboots, install `better-sqlite3`:

```bash
npm install better-sqlite3
```

---

## 🚀 Tutorial & Quick Start

### 1. Basic Single-Process Usage

If you don't need multi-process routing, you can run `JobQueue` natively in a single process.

```typescript
import { JobQueue, SqliteAdapter, createJob } from 'wa-job-queue';

// 1. Initialize Adapter & Queue
const adapter = new SqliteAdapter({ path: './my-jobs.db' });
const queue = new JobQueue({
    adapter,
    concurrency: 5
});

// 2. Define a worker to process jobs
queue.process('send-message', async (job) => {
    console.log(`Processing message to ${job.payload.to}`);
    // Simulate sending message...
    return { status: 'sent', id: job.id };
});

// 3. Start the queue
await queue.start();

// 4. Enqueue a job
const job = createJob({
    type: 'send-message',
    payload: { to: '+1234567890', text: 'Hello World!' }
});
await queue.enqueue(job);
```

### 2. Multi-Process Architecture (Sharded Routing)

For advanced WhatsApp automation running multiple bots across different processes, use `IpcRouter` (Main Process) and `IpcWorker` (Child Processes).

**Main Process (`main.ts`):**
```typescript
import { IpcRouter } from 'wa-job-queue';

const router = new IpcRouter();

// Register shards (child processes)
router.registerShard('bot-123', childProcess1);
router.registerShard('bot-456', childProcess2);

// Route a task to a specific bot
await router.enqueue({
    shardKey: 'bot-123', // <--- Determines which process gets the job
    type: 'broadcast',
    payload: { text: 'System update!' }
});
```

**Child Process (`worker.ts`):**
```typescript
import { JobQueue, SqliteAdapter, IpcWorker } from 'wa-job-queue';

// Each child gets its OWN database to avoid SQLITE_BUSY errors
const adapter = new SqliteAdapter({ path: './bot-123.db' });
const queue = new JobQueue({ adapter, concurrency: 10 });

queue.process('broadcast', async (job) => {
    // Execute bot 123 logic
});

await queue.start();

// Listen for incoming jobs from Main Process
const ipcWorker = new IpcWorker(queue);
ipcWorker.listen();
```

### 3. Using Plugins (e.g., Rate Limiter & Backoff)

`wa-job-queue` exposes a robust Plugin and Retry architecture.

```typescript
import { JobQueue, RateLimiter, ExponentialBackoff } from 'wa-job-queue';

const queue = new JobQueue({
    retryPolicy: new ExponentialBackoff({ initialDelayMs: 1000, maxAttempts: 5 }),
    plugins: [
        new RateLimiter({ maxJobs: 10, windowMs: 1000 }) // 10 jobs per second
    ]
});
```

### 4. Workflows & Chains

You can use the `FlowController` for complex job orchestration.

```typescript
import { FlowController, createJob } from 'wa-job-queue';

const flow = new FlowController(queue);

await flow.addChain([
    createJob({ type: 'download-video', payload: { url: '...' } }),
    createJob({ type: 'compress-video', payload: {} }),
    createJob({ type: 'send-video', payload: { to: 'Alice' } }),
]);
```

---

## 🛠 Advanced Features

- **Recovery:** On a crash, the Queue automatically recovers interrupted jobs natively from the SQLite WAL.
- **Deduplication:** Use the `Deduplicator` plugin to ensure jobs with the same deterministic ID are not enqueued multiple times.
- **Metrics:** Exposes rich runtime metrics plugin for APM integrations.

---

## 📄 License & Code of Conduct

This project is licensed under the [MIT License](LICENSE).

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.