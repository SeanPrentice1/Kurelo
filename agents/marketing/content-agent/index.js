import { anthropic, MODELS } from '../../tools/anthropic.js'
import { buildMemoryContext, getRecentContent } from '../../tools/memory.js'
import { CONTENT_SYSTEM_PROMPT } from '../../prompts/content.js'
import supabase from '../../tools/supabase.js'

export async function runContentAgent({ task, campaignId, campaignName, channelId, slackClient, dependencyContext = [], notifySlack = true, revisionContext = null }) {
  const { product, platform, description, params = {} } = task
  console.log(`[content-agent] Running: ${task.type} / ${platform} for ${product}`)

  // Query content_log for last 21 days before every generation
  const [memory, recentContent] = await Promise.all([
    buildMemoryContext(product, platform),
    getRecentContent(product, platform, 21),
  ])

  const userMessage = buildPrompt({ product, platform, description, params, memory, dependencyContext, recentContent, revisionContext })

  const response = await anthropic.messages.create({
    model:      MODELS.CONTENT,
    max_tokens: 1024,
    system: [
      {
        type:          'text',
        text:          CONTENT_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const parsed = parseOutput(response.content[0].text)

  const { data: item, error } = await supabase
    .from('content_log')
    .insert({
      campaign_id:                campaignId,
      product,
      agent:                      'content',
      task_type:                  task.type,
      platform,
      content_type:               'caption',
      output:                     parsed.caption ?? parsed.text ?? response.content[0].text,
      content_pillar:             parsed.content_pillar             ?? null,
      angle:                      parsed.angle                      ?? null,
      pillar_selection_reasoning: parsed.pillar_selection_reasoning ?? null,
      angle_selection_reasoning:  parsed.angle_selection_reasoning  ?? null,
      metadata: {
        hook:         parsed.hook         ?? '',
        hashtags:     parsed.hashtags     ?? [],
        cta:          parsed.cta          ?? '',
        image_prompt: parsed.image_prompt ?? '',
      },
      status:        'pending',
      slack_channel: channelId,
    })
    .select()
    .single()

  if (error) throw new Error(`content_log insert failed: ${error.message}`)

  console.log(`[content-agent] Done: ${item.id} (pillar: ${item.content_pillar}, angle: ${item.angle})`)
  return item
}

function buildPrompt({ product, platform, description, params, memory, dependencyContext, recentContent, revisionContext }) {
  const parts = [
    `Product: ${product}`,
    `Platform: ${platform ?? 'general'}`,
    `Task: ${description}`,
  ]

  if (params && Object.keys(params).length) {
    parts.push(`\nParameters:\n${JSON.stringify(params, null, 2)}`)
  }

  if (revisionContext) {
    parts.push(`\nREVISION REQUEST — this is a revision of a previously rejected post. Address the feedback specifically:\nFeedback: ${revisionContext.reason}`)
    if (revisionContext.originalCopy) {
      parts.push(`Previous copy (do not reuse):\n${revisionContext.originalCopy.substring(0, 400)}`)
    }
  }

  // Recent content history — drives angle/pillar deduplication
  if (recentContent?.length) {
    parts.push('\nRecent content history for this platform (last 21 days) — do NOT repeat these angles or use the same pillar as the most recent post:')
    const lastPost = recentContent[0]
    if (lastPost?.content_pillar) parts.push(`Most recent pillar (BLOCKED for this post): ${lastPost.content_pillar}`)
    const usedAngles = recentContent.filter(r => r.angle).map(r => r.angle)
    if (usedAngles.length) parts.push(`Blocked angles (used in last 21 days): ${usedAngles.join(', ')}`)
    // Include recent performance data if present
    const withPerf = recentContent.filter(r => r.performance_data && Object.keys(r.performance_data).length > 0)
    if (withPerf.length) {
      parts.push('\nRecent performance signals:')
      for (const r of withPerf.slice(0, 5)) {
        const p = r.performance_data
        parts.push(`- [${r.content_pillar ?? ''}/${r.angle ?? ''}] engagement: ${p.engagement_rate ?? '?'}%, reach: ${p.reach ?? '?'}, likes: ${p.likes ?? '?'}`)
      }
    }
  }

  if (memory.brand?.length) {
    parts.push('\nBrand Context:')
    for (const b of memory.brand) parts.push(`[${b.context_type}] ${b.content}`)
  }

  if (memory.topAssets?.length) {
    parts.push('\nTop Performing Reference Content (learn from structure and tone - do not copy):')
    for (const a of memory.topAssets.slice(0, 3)) {
      parts.push(`- ${a.content.substring(0, 250)}`)
    }
  }

  if (dependencyContext.length) {
    parts.push('\nResearch Context (use to inform the content):')
    for (const ctx of dependencyContext) {
      if (ctx?.output) parts.push(ctx.output.substring(0, 600))
    }
  }

  return parts.join('\n')
}

function parseOutput(raw) {
  try {
    return JSON.parse(raw.trim())
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)
    if (match) {
      try { return JSON.parse(match[1] ?? match[0]) } catch { /* fall through */ }
    }
    return { caption: raw.trim(), hashtags: [], hook: '', cta: '', image_prompt: '' }
  }
}
