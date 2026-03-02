# wa-job-queue — Complete Workflow Documentation

> Version 1.0 | Node.js Job Queue Library (No Redis)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Job Lifecycle](#2-job-lifecycle)
3. [Enqueue Workflow](#3-enqueue-workflow)
4. [Processing Workflow](#4-processing-workflow)
5. [Retry Workflow](#5-retry-workflow)
6. [Persistence & Crash Recovery Workflow](#6-persistence--crash-recovery-workflow)
7. [Plugin Hook Execution Order](#7-plugin-hook-execution-order)
8. [Job Chaining & DAG Flow](#8-job-chaining--dag-flow)
9. [Worker Pool Scaling Workflow](#9-worker-pool-scaling-workflow)
10. [Dead Letter Queue Workflow](#10-dead-letter-queue-workflow)
11. [Development Workflow](#11-development-workflow)
12. [Release Workflow](#12-release-workflow)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PUBLIC API (index.ts)                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │           JobQueue (core)            │
              │  - Orchestrates semua komponen       │
              │  - Expose: enqueue(), pause(),       │
              │    resume(), drain(), shutdown()     │
              └─────┬──────────┬──────────┬─────────┘
                    │          │          │
       ┌────────────▼──┐  ┌───▼──────┐  ┌▼──────────────┐
       │  PriorityHeap │  │Scheduler │  │  WorkerPool    │
       │  (min-heap)   │  │(delayed/ │  │  (N concurrent │
       │  O(log n)     │  │ cron)    │  │   workers)     │
       └───────┬───────┘  └──────────┘  └────────┬───────┘
               │                                  │
       ┌───────▼──────────────────────────────────▼───────┐
       │                StorageAdapter                     │
       │   MemoryAdapter | SqliteAdapter | FileAdapter     │
       └───────────────────────┬───────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Persistence Layer  │
                    │  WALWriter | Snapshot│
                    │  | Recovery          │
                    └─────────────────────┘
```

**Plugin Bus** mengalir horizontal di semua layer:

```
Enqueue ──► [Deduplicator] ──► [RateLimiter] ──► [JobTTL] ──► Heap
Process ──► [Throttle] ──► [Metrics] ──► Worker ──► [Metrics] ──► Result
Fail    ──► [Retry Policy] ──► [DeadLetterQueue] ──► [Metrics]
```

---

## 2. Job Lifecycle

Setiap job melewati FSM (Finite State Machine) berikut:

```
                      ┌─────────┐
                      │ CREATED │  (JobBuilder.build())
                      └────┬────┘
                           │ enqueue()
                           ▼
                      ┌─────────┐
             ┌────────│ PENDING │◄────────────────────┐
             │        └────┬────┘                     │
             │             │ worker picks up          │
             │             ▼                          │
             │        ┌─────────┐                     │
             │        │ ACTIVE  │                     │
             │        └────┬────┘                     │
             │             │                          │
             │      ┌──────┴──────┐                   │
             │      │             │                   │
             │  success        failure                │
             │      │             │                   │
             ▼      ▼             ▼                   │
          PAUSED ┌──────┐    ┌─────────┐    retryable?│
                 │ DONE │    │ FAILED  │──── YES ─────┘
                 └──────┘    └────┬────┘
                                  │ exhausted / non-retryable
                                  ▼
                           ┌────────────┐
                           │    DLQ     │  (Dead Letter Queue)
                           └────────────┘
```

**State Transitions:**

| From | To | Trigger |
|------|----|---------|
| `PENDING` | `ACTIVE` | Worker mengambil job dari heap |
| `ACTIVE` | `DONE` | Handler resolve tanpa error |
| `ACTIVE` | `FAILED` | Handler throw / timeout |
| `FAILED` | `PENDING` | RetryPolicy.shouldRetry() = true |
| `FAILED` | `DLQ` | RetryPolicy.shouldRetry() = false / maxAttempts tercapai |
| `PENDING` | `PAUSED` | queue.pause() dipanggil |
| `PAUSED` | `PENDING` | queue.resume() dipanggil |
| `PENDING` | `EXPIRED` | JobTTL plugin: ttl terlewat sebelum diproses |

---

## 3. Enqueue Workflow

```
caller
  │
  │ queue.enqueue(jobOptions)
  ▼
┌─────────────────────────────────────────────────────┐
│ 1. validateConfig(jobOptions)                        │
│    - Zod schema check                               │
│    - Required fields: type, payload                 │
│    - Throw QueueError jika invalid                  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 2. JobBuilder.build()                                │
│    - Assign ulid() sebagai job.id                   │
│    - Set defaults: priority=5, attempts=0, state=PENDING│
│    - Immutable freeze object                        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 3. Plugin: onEnqueue hooks (serial, in order)        │
│                                                     │
│   a) Deduplicator.onEnqueue(job)                    │
│      - Check job.id di dedupe Set                   │
│      - Jika duplicate → throw DuplicateJobError     │
│      - Jika unique → tambah ke Set                  │
│                                                     │
│   b) RateLimiter.onEnqueue(job)                     │
│      - Ambil bucket untuk job.key / job.userId      │
│      - Consume 1 token                              │
│      - Jika bucket empty → throw RateLimitError     │
│                                                     │
│   c) JobTTL.onEnqueue(job)                          │
│      - Set job.expiresAt = Date.now() + ttl         │
│      - Schedule expiry timer                        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 4. Delayed job check                                 │
│                                                     │
│   if (job.delay > 0)                                │
│     Scheduler.schedule(job, Date.now() + job.delay) │
│     → job tidak masuk heap sekarang                 │
│     → setelah delay, Scheduler.onTick() → ke step 5│
│   else                                              │
│     → langsung ke step 5                           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 5. StorageAdapter.push(job)                          │
│    - PriorityHeap.insert(job)                       │
│    - Key: { priority, insertedAt } untuk FIFO tie   │
│    - WALWriter.append({ op: 'ENQUEUE', job })       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 6. EventEmitter.emit('enqueued', { job })            │
│    - Caller bisa listen: queue.on('enqueued', cb)   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
               return job.id (string)
```

---

## 4. Processing Workflow

```
WorkerPool (polling loop setiap tick)
  │
  │ adapter.peek() → ada job? 
  ▼
┌─────────────────────────────────────────────────────┐
│ 1. Throttle check                                    │
│    - activeWorkers < maxConcurrency?                │
│    - Jika tidak → tunggu worker selesai             │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 2. adapter.pop() → ambil job dengan priority tertinggi│
│    - Atomic via SQLite transaction / in-memory lock │
│    - job.state = ACTIVE                             │
│    - WALWriter.append({ op: 'ACTIVATE', jobId })    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 3. Plugin: onProcess hooks                           │
│    - Metrics.onProcess(job) → increment activeCount │
│    - startTime = clock.now()                        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 4. JobRegistry.lookup(job.type)                      │
│    - Ambil handler function yang terdaftar          │
│    - Jika tidak ada → throw UnknownJobTypeError     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│ 5. Execute handler dengan timeout race               │
│                                                     │
│   Promise.race([                                    │
│     handler(job.payload, jobContext),               │
│     sleep(job.maxDuration).then(() => {             │
│       throw new JobTimeoutError(job.id)             │
│     })                                              │
│   ])                                                │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┴────────┐
           resolve            reject
              │                 │
              ▼                 ▼
     [SUCCESS FLOW]      [FAILURE FLOW]
     (lihat bawah)       (lihat section 5)
```

**SUCCESS FLOW:**

```
resolve(result)
  │
  ├─ job.state = DONE
  ├─ WALWriter.append({ op: 'COMPLETE', jobId, result })
  ├─ Plugin: onComplete(job, result)
  │    └─ Metrics: latency = clock.now() - startTime
  │    └─ Deduplicator: hapus dari Set (allow re-enqueue)
  ├─ FlowController: trigger downstream dependent jobs
  ├─ EventEmitter.emit('completed', { job, result })
  └─ return JobResult.success(result)
```

---

## 5. Retry Workflow

```
handler throw Error
  │
  ├─ job.attempts += 1
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ RetryPolicy.shouldRetry(job.attempts, error)         │
│                                                     │
│   ExponentialBackoff:                               │
│     delay = min(cap, base * 2^attempt) + jitter     │
│     jitter = Math.random() * base                   │
│     return attempts < maxAttempts                   │
│                                                     │
│   LinearBackoff:                                    │
│     delay = fixedInterval                           │
│     return attempts < maxAttempts                   │
│                                                     │
│   NoRetry:                                          │
│     return false (selalu)                           │
│                                                     │
│   CustomRetry:                                      │
│     return userPredicate(attempts, error)           │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┴────────┐
           true               false
              │                 │
              ▼                 ▼
    ┌──────────────────┐  ┌──────────────────────┐
    │ RETRY FLOW       │  │ PERMANENT FAIL FLOW  │
    │                  │  │                      │
    │ job.state=PENDING│  │ job.state=FAILED     │
    │                  │  │ Plugin: onFail(job)  │
    │ if delay > 0:    │  │ WALWriter.append(    │
    │   Scheduler      │  │  {op:'FAIL',jobId})  │
    │   .schedule(job, │  │ DeadLetterQueue      │
    │   now+delay)     │  │   .capture(job)      │
    │ else:            │  │ EventEmitter.emit(   │
    │   heap.insert()  │  │  'failed', {job,err})│
    │                  │  └──────────────────────┘
    │ WALWriter.append(│
    │  {op:'RETRY'})   │
    │ EventEmitter     │
    │  .emit('retrying'│
    │   {job,attempt}) │
    └──────────────────┘
```

**Contoh backoff dengan jitter:**

```
attempt 1 → delay ≈ 1s   (1000ms + random 0-500ms)
attempt 2 → delay ≈ 2s   (2000ms + random 0-500ms)
attempt 3 → delay ≈ 4s   (4000ms + random 0-500ms)
attempt 4 → delay ≈ 8s
attempt 5 → delay ≈ 16s
... capped at maxDelay (default: 60s)
```

---

## 6. Persistence & Crash Recovery Workflow

### 6a. Normal Operation (Write-Ahead Log)

```
Setiap state-changing operation:
  │
  ▼
WALWriter.append(entry)
  │
  ├─ entry = { seq: autoIncrement, op, jobId, timestamp, data }
  ├─ Serialize to JSON line
  └─ fs.appendFileSync(wal.log)  ← synchronous, atomic per-line
```

**WAL Operations:**

| op | Kapan |
|----|-------|
| `ENQUEUE` | Job masuk ke queue |
| `ACTIVATE` | Worker ambil job |
| `COMPLETE` | Job berhasil |
| `FAIL` | Job permanent gagal |
| `RETRY` | Job dijadwalkan retry |
| `EXPIRE` | Job TTL habis |
| `DLQ` | Job masuk dead letter queue |

### 6b. Periodic Snapshot

```
Snapshot.schedule(intervalMs)
  │
  └─ setiap interval:
       │
       ├─ Ambil full state dari adapter
       ├─ Serialize ke snapshot.json
       ├─ Atomic rename: snapshot.tmp → snapshot.json
       └─ Prune WAL entries sebelum snapshot.seq
```

### 6c. Crash Recovery Workflow

```
Process restart / queue.initialize()
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ 1. Recovery.run()                                    │
│    - Cek apakah snapshot.json ada                   │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────┴────────┐
        ada snapshot       tidak ada
              │                 │
              ▼                 ▼
    Load snapshot.json    Start fresh
    Restore state ke
    in-memory adapter
              │
              ▼
┌─────────────────────────────────────────────────────┐
│ 2. Baca WAL entries SETELAH snapshot.seq             │
│    - Parse setiap line                              │
│    - Replay operations secara berurutan             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ 3. Handle in-flight jobs (state = ACTIVE saat crash) │
│    - Semua job dengan state ACTIVE → reset PENDING  │
│    - Reset job.attempts jika configured             │
│    - Ini mencegah job "stuck" selamanya             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ 4. Rebuild PriorityHeap dari restored state          │
│    - Re-insert semua PENDING jobs                   │
│    - Re-schedule PENDING-DELAYED jobs ke Scheduler  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              Queue siap menerima jobs
```

---

## 7. Plugin Hook Execution Order

```
ENQUEUE phase (order matters — stop-on-error):
  1. Deduplicator.onEnqueue()   ← paling awal, cegah duplikat sebelum apapun
  2. RateLimiter.onEnqueue()    ← cek rate sebelum alokasi
  3. JobTTL.onEnqueue()         ← set expiry setelah job diterima

PROCESS phase:
  1. Throttle.onProcess()       ← cek concurrency
  2. Metrics.onProcess()        ← catat mulai

COMPLETE phase:
  1. Metrics.onComplete()       ← catat latency & success count
  2. Deduplicator.onComplete()  ← clear dari dedupe set
  3. FlowController.onComplete()← trigger downstream jobs

FAIL phase:
  1. Metrics.onFail()           ← catat failure count
  2. DeadLetterQueue.onFail()   ← capture jika permanent failure
```

**Custom Plugin Interface:**

```typescript
interface IPlugin {
  name: string
  onEnqueue?(job: Job):  void | Promise<void>
  onProcess?(job: Job):  void | Promise<void>
  onComplete?(job: Job, result: JobResult): void | Promise<void>
  onFail?(job: Job, error: Error): void | Promise<void>
}
```

---

## 8. Job Chaining & DAG Flow

### Single Chain (A → B → C)

```
queue.flow([
  { type: 'sendOTP',    payload: { phone } },
  { type: 'verifyOTP',  payload: { phone } },
  { type: 'activateUser', payload: { userId } },
])
```

```
FlowController internal:
  │
  ├─ Build linked list: A.next = B, B.next = C
  ├─ Enqueue hanya Job A
  │
  │ A completes
  ├─► Enqueue Job B
  │
  │ B completes  
  ├─► Enqueue Job C
  │
  │ A or B FAILS (permanent)
  └─► Emit 'flow:failed', semua downstream dibatalkan
      └─ throw DependencyError di B & C
```

### DAG (Multiple Dependencies)

```
queue.dag({
  nodes: {
    A: { type: 'fetchUser',    payload: {...} },
    B: { type: 'fetchOrders',  payload: {...} },
    C: { type: 'generateReport', payload: {...}, dependsOn: ['A', 'B'] },
    D: { type: 'sendEmail',    payload: {...}, dependsOn: ['C'] },
  }
})
```

```
FlowController.dag():
  │
  ├─ Topological sort (Kahn's algorithm)
  ├─ Validate: no cycles (throw CyclicDependencyError jika ada)
  ├─ Enqueue root nodes (A, B) immediately
  │
  │ A completes → check C.deps → ['A'✓, 'B'?]
  │ B completes → check C.deps → ['A'✓, 'B'✓] → Enqueue C
  │ C completes → check D.deps → ['C'✓] → Enqueue D
  │
  │ Jika A FAILS:
  └─► C & D dibatalkan (DependencyError)
      B tetap berjalan (tidak bergantung pada A)
```

---

## 9. Worker Pool Scaling Workflow

```
WorkerPool.monitor() — berjalan setiap monitorIntervalMs
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Collect metrics                                      │
│  - queueDepth = adapter.size()                      │
│  - activeWorkers = pool.active                      │
│  - idleWorkers = pool.idle                          │
│  - avgProcessingTime = metrics.avgLatency           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Scale-up decision                                    │
│                                                     │
│ if (queueDepth > scaleUpThreshold                   │
│     && activeWorkers < maxWorkers):                 │
│   n = min(scaleUpStep, maxWorkers - activeWorkers)  │
│   for i in n: pool.spawn()                          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Scale-down decision                                  │
│                                                     │
│ if (idleWorkers > scaleDownThreshold                │
│     && activeWorkers > minWorkers):                 │
│   n = idleWorkers - minWorkers                      │
│   for i in n: pool.gracefulKill()  ← tunggu job    │
│                                        selesai dulu │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Health check                                         │
│  - Worker stuck > maxDuration? → forceKill()        │
│  - Worker crash? → respawn() + emit 'worker:error'  │
└─────────────────────────────────────────────────────┘
```

**Default scaling config:**

```typescript
{
  minWorkers: 1,
  maxWorkers: 10,
  scaleUpThreshold: 5,    // scale up jika queue depth > 5
  scaleDownThreshold: 2,  // scale down jika idle workers > 2
  scaleUpStep: 2,         // tambah 2 worker sekaligus
  monitorIntervalMs: 1000
}
```

---

## 10. Dead Letter Queue Workflow

```
Job masuk DLQ
  │
  ├─ DeadLetterQueue.capture(job, lastError)
  │    ├─ job.state = 'dlq'
  │    ├─ dlq.set(job.id, { job, error, capturedAt })
  │    └─ WALWriter.append({ op: 'DLQ', jobId })
  │
  └─ EventEmitter.emit('dead-letter', { job, error })

Inspect DLQ:
  queue.dlq.list()           → semua job di DLQ
  queue.dlq.get(jobId)       → job tertentu
  queue.dlq.size()           → jumlah

Retry dari DLQ (manual):
  queue.dlq.retry(jobId)
    ├─ Ambil job dari DLQ
    ├─ Reset: attempts=0, state=PENDING
    ├─ Optional: beri delay sebelum re-enqueue
    └─ Enqueue ulang ke heap normal

  queue.dlq.retryAll()       → retry semua
  queue.dlq.purge(olderThan) → hapus entries lama
```

---

## 11. Development Workflow

### Setup Awal

```bash
git clone https://github.com/yourorg/wa-job-queue
cd wa-job-queue
npm install

# Build (ESM + CJS + types)
npm run build

# Watch mode untuk development
npm run dev
```

### Branch Strategy

```
main ──────────────────────────────────────────── (always releaseable)
  │
  ├─── develop ─────────────────────────────────── (integration branch)
  │       │
  │       ├─── feat/job-chaining ──────────────── (fitur baru)
  │       ├─── fix/retry-jitter-overflow ─────── (bug fix)
  │       └─── chore/upgrade-zod ────────────── (maintenance)
  │
  └─── hotfix/critical-dlq-bug ──────────────── (urgent fix → main)
```

### Commit Convention

```
feat(retry):    tambah CustomRetry policy dengan predicate
fix(heap):      perbaiki tiebreaker FIFO saat priority sama
chore(deps):    upgrade better-sqlite3 ke 9.x
test(wal):      tambah test crash recovery dengan simulasi SIGKILL
docs(readme):   update API reference untuk FlowController
perf(heap):     optimasi insert O(log n) dengan bulk insert
```

### Running Tests

```bash
# Unit tests saja (cepat, no I/O)
npm run test:unit

# Integration tests (butuh file system temp dir)
npm run test:integration

# Full test suite + coverage
npm run test

# Watch mode saat coding
npm run test:watch

# Single file
npx vitest run tests/unit/core/PriorityHeap.test.ts

# Crash recovery simulation test
npm run test:crash
```

### Code Quality Pipeline (Pre-commit)

```
git commit
  │
  ▼
husky pre-commit hook
  │
  ├─ npm run lint          (ESLint)
  ├─ npm run format:check  (Prettier)
  └─ npm run typecheck     (tsc --noEmit)
       │
   semua pass?
       │
  ┌────┴────┐
  YES       NO
  │         │
commit   abort + show errors
```

---

## 12. Release Workflow

### Versioning (Semantic)

```
MAJOR.MINOR.PATCH

MAJOR → breaking API change
MINOR → fitur baru, backward compatible
PATCH → bug fix
```

### Release Steps

```
1. Update version
   npm version patch|minor|major
   → auto-update package.json
   → auto-create git tag vX.X.X

2. Build production artifacts
   npm run build
   → dist/esm/     (import/export)
   → dist/cjs/     (.cjs require)
   → dist/types/   (.d.ts)

3. Post-build fix
   node scripts/fix-cjs.mjs
   → rename .js → .cjs di dist/cjs/

4. Verify package contents
   npm pack --dry-run
   → pastikan hanya dist/, README.md, package.json

5. Publish
   npm publish --access public

6. Push tags
   git push origin main --tags

7. GitHub Release
   → auto-trigger dari CI workflow
   → attach CHANGELOG entry ke release notes
```

### CI Workflow (GitHub Actions)

```
PR dibuka
  │
  ▼
ci.yml trigger:
  │
  ├─ Job: lint
  │    └─ npm run lint && npm run format:check
  │
  ├─ Job: typecheck
  │    └─ npm run typecheck
  │
  ├─ Job: test (matrix: node 18, 20, 22)
  │    ├─ npm run test:unit
  │    └─ npm run test:integration
  │
  └─ Job: build
       ├─ npm run build
       └─ Verify dist/ tidak kosong

PR merge ke main:
  │
  └─ Job: release (jika tag push)
       ├─ npm publish
       └─ Create GitHub Release
```

---

## Quick Reference: Public API

```typescript
// Inisialisasi
const queue = new JobQueue({
  adapter: new SqliteAdapter({ path: './jobs.db' }),
  persistence: { walPath: './wal.log', snapshotInterval: 60_000 },
  workers: { min: 1, max: 5 },
  plugins: [new RateLimiter(), new Metrics(), new DeadLetterQueue()],
})

// Register handler
queue.register('sendMessage', async (payload, ctx) => {
  await sendWhatsApp(payload.phone, payload.text)
})

// Enqueue
const jobId = await queue.enqueue({
  type: 'sendMessage',
  payload: { phone: '628xx', text: 'Hello!' },
  priority: 8,
  delay: 5000,
  retry: new ExponentialBackoff({ maxAttempts: 3 }),
})

// Events
queue.on('completed', ({ job, result }) => console.log('done', job.id))
queue.on('failed',    ({ job, error }) =>  console.error('fail', error))
queue.on('dead-letter', ({ job }) =>       console.warn('dlq', job.id))

// Control
await queue.pause()
await queue.resume()
await queue.drain()   // tunggu semua job selesai
await queue.shutdown() // graceful stop

// Job chaining
await queue.flow([
  { type: 'step1', payload: {...} },
  { type: 'step2', payload: {...} },
])

// Inspect
queue.metrics.snapshot()  // { processed, failed, depth, avgLatency }
queue.dlq.list()          // semua failed jobs
```