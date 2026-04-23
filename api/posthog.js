// POSTHOG_HOST defaults to US cloud. Set to https://eu.posthog.com for EU cloud.
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com'

async function hogql(projectId, apiKey, query) {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json?.detail || json?.message || `PostHog ${res.status}`)
  }

  return json
}

async function queryProject(projectId, apiKey) {
  if (!projectId) return null

  const [summaryRes, trendRes, topPagesRes, geoRes] = await Promise.all([
    hogql(
      projectId, apiKey,
      `SELECT
         countIf(event = '$pageview')   AS pageviews,
         uniq(distinct_id)             AS unique_visitors,
         uniq(properties.$session_id)  AS sessions
       FROM events
       WHERE timestamp >= now() - INTERVAL 7 DAY`
    ),
    hogql(
      projectId, apiKey,
      `SELECT
         toDate(timestamp)              AS day,
         countIf(event = '$pageview')   AS pageviews
       FROM events
       WHERE timestamp >= now() - INTERVAL 14 DAY
       GROUP BY day
       ORDER BY day ASC`
    ),
    hogql(
      projectId, apiKey,
      `SELECT
         properties.$current_url AS url,
         count()                 AS views
       FROM events
       WHERE event = '$pageview'
         AND timestamp >= now() - INTERVAL 7 DAY
       GROUP BY url
       ORDER BY views DESC
       LIMIT 5`
    ),
    hogql(
      projectId, apiKey,
      `SELECT
         properties.$geoip_country_code AS code,
         properties.$geoip_country_name AS country,
         count()                        AS pageviews
       FROM events
       WHERE event = '$pageview'
         AND timestamp >= now() - INTERVAL 7 DAY
         AND properties.$geoip_country_code IS NOT NULL
         AND properties.$geoip_country_code != ''
       GROUP BY code, country
       ORDER BY pageviews DESC
       LIMIT 30`
    ),
  ])

  const row = summaryRes.results?.[0] || [0, 0, 0]

  // Build country map: { 'AU': 1234, 'US': 500, ... }
  const countryValues = {}
  const countryList = []
  for (const r of (geoRes.results || [])) {
    if (r[0]) {
      countryValues[r[0]] = Number(r[2]) || 0
      countryList.push({ code: r[0], name: r[1] || r[0], pageviews: Number(r[2]) || 0 })
    }
  }

  return {
    pageviews7d:      Number(row[0]) || 0,
    uniqueVisitors7d: Number(row[1]) || 0,
    sessions7d:       Number(row[2]) || 0,
    dailyTrend:    (trendRes.results || []).map(r => ({ day: r[0], pageviews: Number(r[1]) || 0 })),
    topPages:      (topPagesRes.results || []).map(r => ({ url: r[0], views: Number(r[1]) || 0 })),
    countryValues,
    countryList,
  }
}

export default async function handler(req, res) {
  const apiKey = process.env.POSTHOG_API_KEY
  if (!apiKey) return res.json({ configured: false })

  res.setHeader('Cache-Control', 'no-store')

  const crevaxoId = process.env.POSTHOG_CREVAXO_PROJECT_ID
  const rosturaId = process.env.POSTHOG_ROSTURA_PROJECT_ID

  try {
    const [crevaxoResult, rosturaResult] = await Promise.allSettled([
      queryProject(crevaxoId, apiKey),
      queryProject(rosturaId, apiKey),
    ])

    res.json({
      configured: true,
      crevaxo: crevaxoResult.status === 'fulfilled' ? crevaxoResult.value : { error: crevaxoResult.reason?.message },
      rostura:  rosturaResult.status === 'fulfilled' ? rosturaResult.value : { error: rosturaResult.reason?.message },
    })
  } catch (err) {
    res.status(500).json({ configured: true, error: err.message })
  }
}
