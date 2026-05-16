import { anthropic, MODELS } from '../../tools/anthropic.js'
import { ANALYTICS_SYSTEM_PROMPT } from '../../prompts/analytics.js'
import { getAnalytics } from '../../tools/zernio.js'
import supabase from '../../tools/supabase.js'

export async function runAnalyticsAgent({ task, campaignId, campaignName, channelId, slackClient, notifySlack = true }) {
  const { product, description, params = {} } = task
  console.log(`[analytics-agent] Running: ${task.type} for ${product}`)

  const analyticsData = await fetchAnalyticsData(product)
  const userMessage = buildPrompt({ product, description, params, analyticsData })

  const response = await anthropic.messages.create({
    model:      MODELS.ANALYTICS,
    max_tokens: 1024,
    system: [
      {
        type:          'text',
        text:          ANALYTICS_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const parsed = parseOutput(response.content[0].text)
  const outputText = formatInsights(parsed)

  console.log(`[analytics-agent] Done (in-memory): ${task.type}`)

  // Analytics is internal — not persisted to content_log (no approval needed)
  return {
    agent:     'analytics',
    task_type: task.type,
    product,
    output:    outputText,
    metadata: {
      summary:         parsed.summary         ?? '',
      wins:            parsed.wins            ?? [],
      concerns:        parsed.concerns        ?? [],
      insights:        parsed.insights        ?? [],
      recommendations: parsed.recommendations ?? [],
    },
  }
}

async function fetchAnalyticsData(product) {
  const base = process.env.KURELO_URL

  const [phResult, stripeResult, zernioResult] = await Promise.allSettled([
    base ? fetch(`${base}/api/posthog`).then(r => r.json()) : Promise.resolve(null),
    base ? fetch(`${base}/api/stripe`).then(r => r.json())  : Promise.resolve(null),
    process.env.ZERNIO_API_KEY ? getAnalytics({ days: 30 }) : Promise.resolve(null),
  ])

  return {
    posthog: phResult.status === 'fulfilled' && phResult.value
      ? phResult.value[product] ?? phResult.value
      : null,
    stripe:  stripeResult.status === 'fulfilled' ? stripeResult.value : null,
    zernio:  zernioResult.status === 'fulfilled' ? zernioResult.value : null,
  }
}

function buildPrompt({ product, description, params, analyticsData }) {
  const parts = [
    `Product: ${product}`,
    `Task: ${description}`,
  ]

  if (analyticsData.posthog) {
    parts.push('\n=== POSTHOG DATA (last 7 days) ===')
    const ph = analyticsData.posthog
    if (ph.pageviews7d !== undefined) {
      parts.push(`Pageviews: ${ph.pageviews7d}`)
      parts.push(`Unique visitors: ${ph.uniqueVisitors7d}`)
      parts.push(`Bounce rate: ${ph.bounceRate?.toFixed(1)}%`)
      parts.push(`New users: ${ph.newUsers7d} | Returning: ${ph.returningUsers7d}`)
    }
    if (ph.topPages?.length) {
      parts.push(`Top pages: ${ph.topPages.slice(0, 5).map(p => `${p.url} (${p.views})`).join(', ')}`)
    }
  }

  if (analyticsData.stripe?.configured) {
    parts.push('\n=== STRIPE DATA ===')
    const s = analyticsData.stripe
    parts.push(`MRR: $${s.mrr?.toFixed(2)} | 30-day revenue: $${s.revenue30d?.toFixed(2)}`)
    parts.push(`Active subs: ${s.activeSubscriptions} | New (30d): ${s.newSubscriptions30d}`)
  }

  if (analyticsData.zernio) {
    parts.push('\n=== ZERNIO SOCIAL DATA (last 30 days) ===')
    const z = analyticsData.zernio
    if (z.posts?.length)     parts.push(`Posts published: ${z.posts.length}`)
    if (z.totalImpressions)  parts.push(`Total impressions: ${z.totalImpressions}`)
    if (z.totalEngagements)  parts.push(`Total engagements: ${z.totalEngagements}`)
    if (z.engagementRate)    parts.push(`Avg engagement rate: ${z.engagementRate?.toFixed(2)}%`)
    if (z.topPosts?.length) {
      parts.push(`Top posts:\n${z.topPosts.slice(0, 3).map(p =>
        `  - [${p.platform}] ${p.content?.substring(0, 80)}... (${p.engagements} engagements)`
      ).join('\n')}`)
    }
    if (z.platformBreakdown) {
      parts.push(`Platform breakdown: ${Object.entries(z.platformBreakdown)
        .map(([p, d]) => `${p}: ${d.posts} posts, ${d.engagements} engagements`)
        .join(' | ')}`)
    }
  }

  if (!analyticsData.posthog && !analyticsData.stripe?.configured && !analyticsData.zernio) {
    parts.push('\nNote: Live analytics data unavailable. Provide general insights based on product context.')
  }

  if (params && Object.keys(params).length) {
    parts.push(`\nFocus Area:\n${JSON.stringify(params, null, 2)}`)
  }

  return parts.join('\n')
}

function formatInsights(parsed) {
  const sections = []
  if (parsed.summary)                   sections.push(`Summary: ${parsed.summary}`)
  if (parsed.wins?.length)              sections.push(`Wins:\n${parsed.wins.map(w => `- ${w}`).join('\n')}`)
  if (parsed.concerns?.length)          sections.push(`Concerns:\n${parsed.concerns.map(c => `- ${c}`).join('\n')}`)
  if (parsed.insights?.length)          sections.push(`Insights:\n${parsed.insights.map(i => `- ${i}`).join('\n')}`)
  if (parsed.recommendations?.length)   sections.push(`Recommendations:\n${parsed.recommendations.map(r => `- ${r}`).join('\n')}`)
  return sections.join('\n\n')
}

function parseOutput(raw) {
  try {
    return JSON.parse(raw.trim())
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)
    if (match) {
      try { return JSON.parse(match[1] ?? match[0]) } catch { /* fall through */ }
    }
    return { summary: raw.trim(), wins: [], concerns: [], insights: [], recommendations: [] }
  }
}

/**
 * Writes performance data for a single content_log row.
 * Called 48h after posting by the server cron job.
 *
 * Queries Zernio analytics and writes reach, impressions, engagement_rate,
 * likes, comments, saves to the performance_data field.
 */
export async function writePerformanceData(contentId) {
  const { data: item, error } = await supabase
    .from('content_log')
    .select('id, zernio_post_id, platform, product, posted_at, performance_data')
    .eq('id', contentId)
    .single()

  if (error || !item) {
    console.warn(`[analytics-agent] writePerformanceData: content ${contentId} not found`)
    return
  }

  // Skip if performance data already written
  if (item.performance_data && Object.keys(item.performance_data).length > 0) return

  if (!process.env.ZERNIO_API_KEY) {
    console.warn('[analytics-agent] ZERNIO_API_KEY not set — skipping performance data write')
    return
  }

  try {
    // Fetch post-level analytics from Zernio
    const params = new URLSearchParams({ days: '3' })
    if (item.platform) params.set('platform', item.platform)
    if (item.zernio_post_id) params.set('post_id', item.zernio_post_id)

    const res = await fetch(`https://zernio.com/api/v1/analytics?${params}`, {
      headers: {
        'Authorization': `Bearer ${process.env.ZERNIO_API_KEY}`,
        'Content-Type':  'application/json',
      },
    })

    if (!res.ok) {
      console.warn(`[analytics-agent] Zernio analytics returned ${res.status} for ${contentId}`)
      return
    }

    const data = await res.json()

    // Extract metrics — handle both top-level and nested response shapes
    const post    = data?.posts?.find?.(p => p._id === item.zernio_post_id || p.id === item.zernio_post_id) ?? data
    const perfData = {
      reach:            post?.reach            ?? post?.totalReach            ?? null,
      impressions:      post?.impressions      ?? post?.totalImpressions      ?? null,
      engagement_rate:  post?.engagementRate   ?? post?.engagement_rate       ?? null,
      likes:            post?.likes            ?? post?.likeCount             ?? null,
      comments:         post?.comments         ?? post?.commentCount          ?? null,
      saves:            post?.saves            ?? post?.saveCount             ?? null,
      fetched_at:       new Date().toISOString(),
    }

    await supabase
      .from('content_log')
      .update({ performance_data: perfData })
      .eq('id', contentId)

    console.log(`[analytics-agent] Performance data written for ${contentId}:`, perfData)
  } catch (err) {
    console.error(`[analytics-agent] writePerformanceData failed for ${contentId}: ${err.message}`)
  }
}

/**
 * Finds all posts scheduled more than 48h ago with empty performance_data
 * and writes their performance metrics. Called by the server cron job.
 */
export async function backfillPerformanceData() {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - 48)

  const { data: items, error } = await supabase
    .from('content_log')
    .select('id')
    .in('status', ['scheduled', 'posted'])
    .not('zernio_post_id', 'is', null)
    .lte('scheduled_for', cutoff.toISOString())
    .eq('performance_data', '{}')
    .limit(20)

  if (error) {
    console.error('[analytics-agent] backfillPerformanceData query failed:', error.message)
    return
  }

  if (!items?.length) return

  console.log(`[analytics-agent] Writing performance data for ${items.length} posts`)
  for (const item of items) {
    await writePerformanceData(item.id)
  }
}
