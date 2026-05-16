import 'dotenv/config'
import { createSlackApp } from './slack-bot/index.js'
import { backfillPerformanceData } from './marketing/analytics-agent/index.js'

const PORT = parseInt(process.env.PORT || '3000', 10)
// Check for posts needing performance data every hour
const PERF_CHECK_INTERVAL_MS = 60 * 60 * 1000

async function main() {
  const { app, start } = createSlackApp()

  // Health check endpoint (Railway/Render needs this)
  app.receiver.router.get('/health', (req, res) => {
    res.json({ ok: true, service: 'kurelo-agents', ts: new Date().toISOString() })
  })

  await start(PORT)
  console.log(`⚡ Kurelo Agents running on port ${PORT}`)

  // Backfill performance data for posts older than 48h
  backfillPerformanceData().catch(err => console.error('[server] Initial backfill error:', err.message))
  setInterval(() => {
    backfillPerformanceData().catch(err => console.error('[server] Backfill error:', err.message))
  }, PERF_CHECK_INTERVAL_MS)

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received — shutting down')
    await app.stop()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
