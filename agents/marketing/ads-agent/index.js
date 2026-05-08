import { anthropic, MODELS } from '../../tools/anthropic.js'
import { buildMemoryContext } from '../../tools/memory.js'
import { ADS_SYSTEM_PROMPT } from '../../prompts/ads.js'
import supabase from '../../tools/supabase.js'

export async function runAdsAgent({ task, campaignId, campaignName, channelId, slackClient, dependencyContext = [], notifySlack = true }) {
  const { product, platform, description, params = {} } = task
  console.log(`[ads-agent] Running: ${task.type} for ${product}`)

  const memory = await buildMemoryContext(product)
  const userMessage = buildPrompt({ product, platform, description, params, memory, dependencyContext })

  const response = await anthropic.messages.create({
    model:      MODELS.ADS,
    max_tokens: 1024,
    system: [
      {
        type:          'text',
        text:          ADS_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const parsed = parseOutput(response.content[0].text)
  const outputText = [parsed.headline, parsed.primary_text].filter(Boolean).join('\n\n')

  const { data: item, error } = await supabase
    .from('content_log')
    .insert({
      campaign_id:   campaignId,
      product,
      agent:         'ads',
      task_type:     task.type,
      platform:      platform ?? task.type.replace('_ad_copy', '').replace('_', ''),
      content_type:  'ad_copy',
      output:        outputText,
      metadata: {
        headline:     parsed.headline     ?? '',
        primary_text: parsed.primary_text ?? '',
        description:  parsed.description  ?? '',
        cta:          parsed.cta          ?? '',
        variants:     parsed.variants     ?? [],
      },
      status:        'pending',
      slack_channel: channelId,
    })
    .select()
    .single()

  if (error) throw new Error(`content_log insert failed: ${error.message}`)

  console.log(`[ads-agent] Done: ${item.id}`)
  return item
}

function buildPrompt({ product, platform, description, params, memory, dependencyContext }) {
  const parts = [
    `Product: ${product}`,
    `Ad Platform: ${platform ?? 'meta'}`,
    `Task: ${description}`,
  ]

  if (params && Object.keys(params).length) {
    parts.push(`\nParameters:\n${JSON.stringify(params, null, 2)}`)
  }

  if (memory.brand?.length) {
    parts.push('\nBrand Context:')
    for (const b of memory.brand) parts.push(`[${b.context_type}] ${b.content}`)
  }

  if (dependencyContext.length) {
    parts.push('\nResearch Context (use to sharpen targeting and messaging):')
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
    return { headline: '', primary_text: raw.trim(), description: '', cta: 'Learn More', variants: [] }
  }
}
