const POSTHOG_HOST = 'https://app.posthog.com'

async function queryProject(projectId, apiKey) {
  if (!projectId) return null

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  // Parallel queries: 7-day summary + daily pageview trend (last 14 days)
  const summaryQuery = {
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT
          countIf(event = '$pageview') AS pageviews,
          uniq(distinct_id)           AS unique_visitors,
          uniqIf(properties.$session_id, event = '$pageview' AND properties.$session_id != '') AS sessions
        FROM events
        WHERE timestamp >= now() - INTERVAL 7 DAY
      `,
    },
  }

  const trendQuery = {
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT
          toDate(timestamp) AS day,
          countIf(event = '$pageview') AS pageviews
        FROM events
        WHERE timestamp >= now() - INTERVAL 14 DAY
        GROUP BY day
        ORDER BY day ASC
      `,
    },
  }

  const topPagesQuery = {
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT
          properties.$current_url AS url,
          count() AS views
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= now() - INTERVAL 7 DAY
        GROUP BY url
        ORDER BY views DESC
        LIMIT 5
      `,
    },
  }

  const [summaryRes, trendRes, topPagesRes] = await Promise.all([
    fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(summaryQuery),
    }),
    fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(trendQuery),
    }),
    fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(topPagesQuery),
    }),
  ])

  const [summary, trend, topPages] = await Promise.all([
    summaryRes.json(),
    trendRes.json(),
    topPagesRes.json(),
  ])

  const row = summary.results?.[0] || [0, 0, 0]

  return {
    pageviews7d: row[0] || 0,
    uniqueVisitors7d: row[1] || 0,
    sessions7d: row[2] || 0,
    dailyTrend: (trend.results || []).map(r => ({ day: r[0], pageviews: r[1] })),
    topPages: (topPages.results || []).map(r => ({ url: r[0], views: r[1] })),
  }
}

export default async function handler(req, res) {
  const apiKey = process.env.POSTHOG_API_KEY
  if (!apiKey) {
    return res.json({ configured: false })
  }

  res.setHeader('Cache-Control', 'no-store')

  const crevaxoId = process.env.POSTHOG_CREVAXO_PROJECT_ID
  const rosturaId = process.env.POSTHOG_ROSTURA_PROJECT_ID

  try {
    const [crevaxo, rostura] = await Promise.all([
      queryProject(crevaxoId, apiKey),
      queryProject(rosturaId, apiKey),
    ])

    res.json({
      configured: true,
      crevaxo,
      rostura,
    })
  } catch (err) {
    res.status(500).json({ configured: true, error: err.message })
  }
}
