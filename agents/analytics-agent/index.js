import { anthropic, MODELS } from '../tools/anthropic.js'
import { ANALYTICS_SYSTEM_PROMPT } from '../prompts/analytics.js'
import { approvalBlocks } from '../tools/slack.js'
import supabase from '../tools/supabase.js'

export async function runAnalyticsAgent({ task, campaignId, campaignName, channelId, slackClient }) {
  const { product, description, params = {} } = task
  console.log(`[analytics-agent] Running: ${task.type} for ${product}`)

  // Fetch live data from our own Vercel API endpoints
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

  const { data: item, error } = await supabase
    .from('content_log')
    .insert({
      campaign_id:   campaignId,
      product,
      agent:         'analytics',
      task_type:     task.type,
      platform:      null,
      content_type:  'insight',
      output:        outputText,
      metadata: {
        summary:         parsed.summary         ?? '',
        wins:            parsed.wins            ?? [],
        concerns:        parsed.concerns        ?? [],
        insights:        parsed.insights        ?? [],
        recommendations: parsed.recommendations ?? [],
      },
      status:        'pending',
      slack_channel: channelId,
    })
    .select()
    .single()

  if (error) throw new Error(`content_log insert failed: ${error.message}`)

  const msg = await slackClient.chat.postMessage({
    channel: channelId,
    text:    `Analytics ready for approval: ${task.type}`,
    blocks:  approvalBlocks({
      contentId:    item.id,
      campaignName,
      agent:        'analytics',
      taskType:     task.type,
      platform:     null,
      output:       item.output,
      metadata:     item.metadata,
    }),
  })

  await supabase
    .from('content_log')
    .update({ slack_ts: msg.ts })
    .eq('id', item.id)

  console.log(`[analytics-agent] Done: ${item.id}`)
  return item
}

async function fetchAnalyticsData(product) {
  const base = process.env.KURELO_URL
  if (!base) return { posthog: null, stripe: null, note: 'KURELO_URL not configured' }

  const [phResult, stripeResult] = await Promise.allSettled([
    fetch(`${base}/api/posthog`).then(r => r.json()),
    fetch(`${base}/api/stripe`).then(r => r.json()),
  ])

  return {
    posthog: phResult.status === 'fulfilled' ? phResult.value[product] ?? phResult.value : null,
    stripe:  stripeResult.status === 'fulfilled' ? stripeResult.value : null,
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
      parts.push(`Sessions: ${ph.sessions7d}`)
      parts.push(`Bounce rate: ${ph.bounceRate?.toFixed(1)}%`)
      parts.push(`Avg session duration: ${Math.round((ph.avgSessionDuration ?? 0) / 60)}m ${Math.round((ph.avgSessionDuration ?? 0) % 60)}s`)
      parts.push(`New users: ${ph.newUsers7d} | Returning: ${ph.returningUsers7d}`)
    }
    if (ph.topPages?.length) {
      parts.push(`Top pages: ${ph.topPages.slice(0, 5).map(p => `${p.url} (${p.views})`).join(', ')}`)
    }
    if (ph.referrers?.length) {
      parts.push(`Traffic sources: ${ph.referrers.slice(0, 5).map(r => `${r.source} (${r.pageviews})`).join(', ')}`)
    }
  }

  if (analyticsData.stripe?.configured) {
    parts.push('\n=== STRIPE DATA ===')
    const s = analyticsData.stripe
    parts.push(`MRR: $${s.mrr?.toFixed(2)}`)
    parts.push(`30-day revenue: $${s.revenue30d?.toFixed(2)}`)
    parts.push(`Active subscriptions: ${s.activeSubscriptions}`)
    parts.push(`New subscriptions (30d): ${s.newSubscriptions30d}`)
  }

  if (!analyticsData.posthog && !analyticsData.stripe?.configured) {
    parts.push('\nNote: Live analytics data unavailable. Provide general insights based on the product context.')
  }

  if (params && Object.keys(params).length) {
    parts.push(`\nFocus Area:\n${JSON.stringify(params, null, 2)}`)
  }

  return parts.join('\n')
}

function formatInsights(parsed) {
  const sections = []
  if (parsed.summary)              sections.push(`Summary: ${parsed.summary}`)
  if (parsed.wins?.length)         sections.push(`Wins:\n${parsed.wins.map(w => `✅ ${w}`).join('\n')}`)
  if (parsed.concerns?.length)     sections.push(`Concerns:\n${parsed.concerns.map(c => `⚠️ ${c}`).join('\n')}`)
  if (parsed.insights?.length)     sections.push(`Insights:\n${parsed.insights.map(i => `• ${i}`).join('\n')}`)
  if (parsed.recommendations?.length) sections.push(`Recommendations:\n${parsed.recommendations.map(r => `→ ${r}`).join('\n')}`)
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
