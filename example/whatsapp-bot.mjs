/**
 * examples/whatsapp-bot.mjs
 *
 * Contoh penggunaan wa-job-queue untuk bot WhatsApp
 * yang handle 1200+ user secara concurrent dengan priority.
 */

import { JobQueue, Priority } from 'wa-job-queue'

// ─── Types payload ──────────────────────────────────────────────────────────
/**
 * @typedef {Object} WaPayload
 * @property {string} phone
 * @property {string} message
 * @property {'text'|'image'|'template'} type
 * @property {string} [mediaUrl]
 * @property {string} [templateName]
 */

// ─── Init Queue ──────────────────────────────────────────────────────────────
const queue = new JobQueue({
  concurrency: 100,          // 100 worker concurrent
  maxQueueSize: 50_000,      // tampung 50k job
  defaultTimeout: 15_000,    // 15 detik per job
  defaultMaxAttempts: 3,
  retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 10_000), // 0.5s, 1s, 2s, ...
  rateLimitPerUser: 1,       // 1 job aktif per user sekaligus
})

// ─── Register Handler ────────────────────────────────────────────────────────
queue.process(async (job, signal) => {
  const { phone, message, type } = job.payload

  // cek apakah sudah di-cancel
  if (signal.aborted) throw new Error('Job cancelled')

  // simulasi kirim pesan (ganti dengan Baileys/WA-Web.js)
  await sendWhatsAppMessage({ phone, message, type })

  return { phone, sentAt: Date.now() }
})

// ─── Event Listeners ─────────────────────────────────────────────────────────
queue.on('job:completed', ({ jobId, userId, duration }) => {
  console.log(`✅ Job ${jobId} user ${userId} selesai dalam ${duration}ms`)
})

queue.on('job:failed', ({ jobId, userId, error, attempts }) => {
  console.error(`❌ Job ${jobId} user ${userId} gagal setelah ${attempts} attempts:`, error?.message)
})

queue.on('job:dead', (job) => {
  console.error(`💀 Job ${job.id} user ${job.userId} mati - perlu manual review`)
  // simpan ke dead letter queue / database
})

queue.on('queue:drained', () => {
  console.log('🎉 Semua job selesai diproses')
})

// ─── Simulasi incoming messages ───────────────────────────────────────────────

// OTP / verifikasi - CRITICAL priority
await queue.add('user_001', {
  phone: '+628111111111',
  message: 'Kode OTP Anda: 123456. Berlaku 5 menit.',
  type: 'text',
}, { priority: Priority.CRITICAL })

// Pesan biasa - NORMAL priority
await queue.add('user_002', {
  phone: '+628222222222',
  message: 'Halo! Ada yang bisa dibantu?',
  type: 'text',
}, { priority: Priority.NORMAL })

// Notifikasi promo - LOW priority, delay 5 detik
await queue.add('user_003', {
  phone: '+628333333333',
  message: 'Promo spesial hari ini! Diskon 50% untuk semua produk.',
  type: 'text',
}, {
  priority: Priority.LOW,
  delay: 5_000,
})

// ─── Batch add 1200 user sekaligus ───────────────────────────────────────────
const users = Array.from({ length: 1200 }, (_, i) => ({
  userId: `user_${String(i + 100).padStart(4, '0')}`,
  payload: {
    phone: `+628${String(i + 100).padStart(9, '0')}`,
    message: `Pesan untuk user ${i + 100}`,
    type: 'text',
  },
  opts: {
    priority: i % 10 === 0 ? Priority.HIGH : Priority.NORMAL, // 10% HIGH priority
  },
}))

console.log('📨 Menambahkan 1200 job...')
const startTime = Date.now()
const jobs = await queue.addBatch(users)
console.log(`✅ ${jobs.length} job ditambahkan dalam ${Date.now() - startTime}ms`)

// ─── Monitor metrics setiap 2 detik ──────────────────────────────────────────
const monitor = setInterval(() => {
  const m = queue.getMetrics()
  console.log('📊 Metrics:', {
    waiting: m.waiting,
    active: m.active,
    completed: m.completed,
    failed: m.failed,
    throughput: `${m.throughput.toFixed(1)} jobs/s`,
    avgDuration: `${m.avgDuration}ms`,
    utilization: `${(m.workerUtilization * 100).toFixed(1)}%`,
  })

  if (m.waiting === 0 && m.active === 0) {
    clearInterval(monitor)
  }
}, 2_000)

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...')
  clearInterval(monitor)
  await queue.shutdown()
  process.exit(0)
})

// ─── Simulasi kirim pesan (placeholder) ──────────────────────────────────────
async function sendWhatsAppMessage({ phone, message, type }) {
  // Ganti dengan implementasi Baileys / WA-Web.js Anda:
  // await sock.sendMessage(phone + '@s.whatsapp.net', { text: message })
  await new Promise(r => setTimeout(r, Math.random() * 200 + 50)) // simulasi latency
}
