import 'dotenv/config'
import { createSlackApp } from './slack-bot/index.js'

const PORT = parseInt(process.env.PORT || '3000', 10)

async function main() {
  const { app, start } = createSlackApp()

  // Health check endpoint (Railway/Render needs this)
  app.receiver.router.get('/health', (req, res) => {
    res.json({ ok: true, service: 'kurelo-agents', ts: new Date().toISOString() })
  })

  await start(PORT)
  console.log(`⚡ Kurelo Agents running on port ${PORT}`)

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
