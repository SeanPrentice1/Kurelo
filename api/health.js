const APPS = [
  { id: 'crevaxo', name: 'Crevaxo', url: 'https://www.crevaxo.com' },
  { id: 'rostura', name: 'Rostura', url: 'https://www.rostura.com' },
]

async function pingApp(app) {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(app.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Kurelo-Dashboard/1.0' },
    })

    clearTimeout(timeout)
    const latency = Date.now() - start

    return {
      id: app.id,
      name: app.name,
      url: app.url,
      status: response.ok ? 'up' : 'degraded',
      statusCode: response.status,
      latency,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      id: app.id,
      name: app.name,
      url: app.url,
      status: 'down',
      statusCode: null,
      latency: Date.now() - start,
      error: err.name === 'AbortError' ? 'Request timed out' : err.message,
      checkedAt: new Date().toISOString(),
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const results = await Promise.all(APPS.map(pingApp))

  const allUp = results.every(r => r.status === 'up')
  const anyDown = results.some(r => r.status === 'down')

  res.json({
    overall: anyDown ? 'down' : allUp ? 'up' : 'degraded',
    apps: results,
  })
}
