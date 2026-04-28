const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com'

async function hogql(projectId, apiKey, query) {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.detail || json?.message || `PostHog ${res.status}`)
  return json
}

async function queryProject(projectId, apiKey) {
  if (!projectId) return null

  const [
    summaryRes, trendRes, topPagesRes, geoRes,
    extendedRes, newReturnRes,
    deviceRes, browserRes, osRes, referrerRes, topEventsRes,
  ] = await Promise.all([

    // 1. Core summary
    hogql(projectId, apiKey, `
      SELECT
        countIf(event = '$pageview')  AS pageviews,
        uniq(distinct_id)            AS unique_visitors,
        uniq(properties.$session_id) AS sessions
      FROM events
      WHERE timestamp >= now() - INTERVAL 7 DAY`),

    // 2. Daily pageview trend (14d)
    hogql(projectId, apiKey, `
      SELECT toDate(timestamp) AS day, countIf(event = '$pageview') AS pageviews
      FROM events
      WHERE timestamp >= now() - INTERVAL 14 DAY
      GROUP BY day ORDER BY day ASC`),

    // 3. Top pages
    hogql(projectId, apiKey, `
      SELECT properties.$current_url AS url, count() AS views
      FROM events
      WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY
      GROUP BY url ORDER BY views DESC LIMIT 8`),

    // 4. Geo
    hogql(projectId, apiKey, `
      SELECT
        properties.$geoip_country_code AS code,
        properties.$geoip_country_name AS country,
        count() AS pageviews
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 7 DAY
        AND properties.$geoip_country_code IS NOT NULL
        AND properties.$geoip_country_code != ''
      GROUP BY code, country ORDER BY pageviews DESC LIMIT 30`),

    // 5. Bounce rate + avg session duration
    hogql(projectId, apiKey, `
      SELECT
        countIf(pv_count = 1) * 100.0 / count() AS bounce_rate,
        avgIf(duration, duration > 0)            AS avg_duration
      FROM (
        SELECT
          properties.$session_id                                        AS sid,
          countIf(event = '$pageview')                                  AS pv_count,
          dateDiff('second', min(timestamp), max(timestamp))            AS duration
        FROM events
        WHERE timestamp >= now() - INTERVAL 7 DAY
          AND properties.$session_id != ''
          AND properties.$session_id IS NOT NULL
        GROUP BY sid
      )`),

    // 6. New vs returning visitors
    hogql(projectId, apiKey, `
      SELECT
        countIf(first_seen >= now() - INTERVAL 7 DAY) AS new_users,
        countIf(first_seen <  now() - INTERVAL 7 DAY) AS returning_users
      FROM (
        SELECT distinct_id, min(timestamp) AS first_seen
        FROM events GROUP BY distinct_id
        HAVING max(timestamp) >= now() - INTERVAL 7 DAY
      )`),

    // 7. Device type
    hogql(projectId, apiKey, `
      SELECT coalesce(properties.$device_type, 'Unknown') AS device, count() AS pageviews
      FROM events
      WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY
      GROUP BY device ORDER BY pageviews DESC`),

    // 8. Browser
    hogql(projectId, apiKey, `
      SELECT coalesce(properties.$browser, 'Unknown') AS browser, count() AS pageviews
      FROM events
      WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY
      GROUP BY browser ORDER BY pageviews DESC LIMIT 7`),

    // 9. OS
    hogql(projectId, apiKey, `
      SELECT coalesce(properties.$os, 'Unknown') AS os, count() AS pageviews
      FROM events
      WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY
      GROUP BY os ORDER BY pageviews DESC LIMIT 7`),

    // 10. Traffic sources (referring domain)
    hogql(projectId, apiKey, `
      SELECT
        coalesce(nullIf(properties.$referring_domain, ''), 'Direct') AS source,
        count() AS pageviews
      FROM events
      WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY
      GROUP BY source ORDER BY pageviews DESC LIMIT 8`),

    // 11. Top custom events
    hogql(projectId, apiKey, `
      SELECT event, count() AS count
      FROM events
      WHERE event NOT IN (
        '$pageview','$pageleave','$autocapture','$identify',
        '$set','$opt_in','$groupidentify','$feature_flag_called','$rageclick'
      )
      AND timestamp >= now() - INTERVAL 7 DAY
      GROUP BY event ORDER BY count DESC LIMIT 8`),
  ])

  const row   = summaryRes.results?.[0]  || [0, 0, 0]
  const extRow = extendedRes.results?.[0] || [0, 0]
  const nrRow  = newReturnRes.results?.[0] || [0, 0]

  const countryValues = {}
  const countryList   = []
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
    bounceRate:       Number(extRow[0]) || 0,
    avgSessionDuration: Number(extRow[1]) || 0,
    newUsers7d:       Number(nrRow[0]) || 0,
    returningUsers7d: Number(nrRow[1]) || 0,
    dailyTrend:  (trendRes.results    || []).map(r => ({ day: r[0], pageviews: Number(r[1]) || 0 })),
    topPages:    (topPagesRes.results  || []).map(r => ({ url: r[0], views: Number(r[1]) || 0 })),
    topEvents:   (topEventsRes.results || []).map(r => ({ event: r[0], count: Number(r[1]) || 0 })),
    devices:     (deviceRes.results    || []).map(r => ({ device: r[0], pageviews: Number(r[1]) || 0 })),
    browsers:    (browserRes.results   || []).map(r => ({ browser: r[0], pageviews: Number(r[1]) || 0 })),
    os:          (osRes.results        || []).map(r => ({ os: r[0], pageviews: Number(r[1]) || 0 })),
    referrers:   (referrerRes.results  || []).map(r => ({ source: r[0], pageviews: Number(r[1]) || 0 })),
    countryValues,
    countryList,
  }
}

export default async function handler(req, res) {
  const apiKey = process.env.POSTHOG_API_KEY
  if (!apiKey) return res.json({ configured: false })

  res.setHeader('Cache-Control', 'no-store')

  const [crevaxoResult, rosturaResult] = await Promise.allSettled([
    queryProject(process.env.POSTHOG_CREVAXO_PROJECT_ID, apiKey),
    queryProject(process.env.POSTHOG_ROSTURA_PROJECT_ID, apiKey),
  ])

  res.json({
    configured: true,
    crevaxo: crevaxoResult.status === 'fulfilled' ? crevaxoResult.value : { error: crevaxoResult.reason?.message },
    rostura:  rosturaResult.status === 'fulfilled' ? rosturaResult.value : { error: rosturaResult.reason?.message },
  })
}
