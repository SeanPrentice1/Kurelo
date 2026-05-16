// TODO: Replace with fal.ai video generation API in future build

import { anthropic, MODELS } from '../../tools/anthropic.js'
import supabase from '../../tools/supabase.js'

const REEL_SYSTEM_PROMPT = `You are the Kurelo Reel Brief Agent — you write production briefs for short-form video reels.

You do NOT generate the video. You write a brief a human will follow to record their own screen recording using Screen Studio or similar.

OUTPUT FORMAT — return ONLY this JSON object, no markdown, no explanation:
{
  "hook": string (the first words spoken or shown on screen — must stop the scroll in under 2 seconds),
  "scene": string (exact description of what should appear on screen — app screens, actions, flows — specific and actionable),
  "duration": string (target duration, e.g. "15-20 seconds"),
  "caption": string (the full post caption, ready to publish — platform-appropriate tone)
}

HARD CONSTRAINTS:
- NO face on camera. NO voiceover. Screen recording only.
- NEVER use em dashes. Hyphens only.
- NEVER sound like AI wrote it.
- Hook must work in silence (text overlay or action-driven).
- Scene description must be specific enough for a non-creative to execute.`

export async function runReelHandler({ task, campaignId, campaignName, channelId, slackClient }) {
  const { product, platform, description, params = {} } = task
  console.log(`[reel-handler] Generating reel brief: ${task.type} / ${platform} for ${product}`)

  const userMessage = [
    `Product: ${product}`,
    `Platform: ${platform ?? 'instagram'}`,
    `Task: ${description}`,
    params && Object.keys(params).length ? `\nParameters:\n${JSON.stringify(params, null, 2)}` : '',
  ].filter(Boolean).join('\n')

  const response = await anthropic.messages.create({
    model:      MODELS.CONTENT,
    max_tokens: 512,
    system:     REEL_SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
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
      content_type:  'reel',
      output:        parsed.caption ?? response.content[0].text,
      asset_status:  'production_required',
      metadata: {
        hook:     parsed.hook     ?? '',
        scene:    parsed.scene    ?? '',
        duration: parsed.duration ?? '',
        caption:  parsed.caption  ?? '',
      },
      status:        'pending',
      slack_channel: channelId,
    })
    .select()
    .single()

  if (error) throw new Error(`reel content_log insert failed: ${error.message}`)

  console.log(`[reel-handler] Brief ready: ${item.id}`)
  return item
}

function parseOutput(raw) {
  try {
    return JSON.parse(raw.trim())
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)
    if (match) {
      try { return JSON.parse(match[1] ?? match[0]) } catch { /* fall through */ }
    }
    return { hook: '', scene: raw.trim(), duration: '15-20 seconds', caption: '' }
  }
}
