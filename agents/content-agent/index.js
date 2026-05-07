import { anthropic, MODELS } from '../tools/anthropic.js'
import { buildMemoryContext, formatMemoryContext } from '../tools/memory.js'
import { CONTENT_SYSTEM_PROMPT } from '../prompts/content.js'
import { approvalBlocks } from '../tools/slack.js'
import supabase from '../tools/supabase.js'

export async function runContentAgent({ task, campaignId, campaignName, channelId, slackClient, dependencyContext = [], skipSlack = false }) {
  const { product, platform, description, params = {} } = task
  console.log(`[content-agent] Running: ${task.type} / ${platform} for ${product}`)

  const memory = await buildMemoryContext(product, platform)

  const userMessage = buildPrompt({ product, platform, description, params, memory, dependencyContext })

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
      campaign_id:   campaignId,
      product,
      agent:         'content',
      task_type:     task.type,
      platform,
      content_type:  'caption',
      output:        parsed.caption ?? parsed.text ?? response.content[0].text,
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

  // skipSlack = true when the designer agent will handle the Slack post
  if (!skipSlack) {
    const msg = await slackClient.chat.postMessage({
      channel: channelId,
      text:    `Content ready for approval: ${task.type}`,
      blocks:  approvalBlocks({
        contentId:    item.id,
        campaignName,
        agent:        'content',
        taskType:     task.type,
        platform,
        output:       item.output,
        metadata:     item.metadata,
      }),
    })

    await supabase
      .from('content_log')
      .update({ slack_ts: msg.ts })
      .eq('id', item.id)
  }

  console.log(`[content-agent] Done: ${item.id}`)
  return item
}

function buildPrompt({ product, platform, description, params, memory, dependencyContext }) {
  const parts = [
    `Product: ${product}`,
    `Platform: ${platform ?? 'general'}`,
    `Task: ${description}`,
  ]

  if (params && Object.keys(params).length) {
    parts.push(`\nParameters:\n${JSON.stringify(params, null, 2)}`)
  }

  if (memory.brand?.length) {
    parts.push('\nBrand Context:')
    for (const b of memory.brand) parts.push(`[${b.context_type}] ${b.content}`)
  }

  if (memory.topAssets?.length) {
    parts.push('\nTop Performing Reference Content (learn from structure and tone — do not copy):')
    for (const a of memory.topAssets.slice(0, 3)) {
      parts.push(`• ${a.content.substring(0, 250)}`)
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
