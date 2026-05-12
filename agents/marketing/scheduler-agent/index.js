import { promoteToAssetLibrary, getCampaignPostingStrategy } from '../../tools/memory.js'
import { schedulePost, buildPostText } from '../../tools/zernio.js'
import { scheduleOptionsBlocks, scheduleConfirmedBlocks } from '../../tools/slack.js'
import supabase from '../../tools/supabase.js'

const PLATFORM_LABELS = {
  instagram:  'Instagram',
  tiktok:     'TikTok',
  linkedin:   'LinkedIn',
  reddit:     'Reddit',
  twitter:    'Twitter/X',
  meta_ads:   'Meta Ads',
  google_ads: 'Google Ads',
}

// Fallback prime posting times per platform (UTC hours) — used when no campaign
// posting_strategy has been persisted by the research agent.
const PRIME_HOUR = {
  instagram:  17,
  tiktok:     17,
  twitter:    14,
  linkedin:   14,
  reddit:     15,
  meta_ads:   14,
  google_ads: 14,
}

/**
 * Step 1 — Called immediately after content is approved.
 *
 * Fetches the campaign's research-backed posting_strategy, calculates smart
 * schedule options that:
 *   - Use strategy time windows from the research agent (falls back to
 *     PRIME_HOUR constants if no strategy is available)
 *   - Avoid calendar days already taken by other posts for the same
 *     platform/product
 *   - Immediately write a provisional scheduled_for so subsequent
 *     suggestSchedule calls (e.g. for a 5-post campaign approved at once)
 *     don't collide on the same date
 *
 * Does NOT call Zernio yet — that only happens in executeSchedule.
 */
export async function suggestSchedule({ contentId, channelId, slackClient }) {
  console.log(`[scheduler-agent] Suggesting schedule for: ${contentId}`)

  const { data: item, error } = await supabase
    .from('content_log')
    .select('id, platform, product, campaign_id, metadata, status')
    .eq('id', contentId)
    .single()

  if (error || !item) {
    console.error(`[scheduler-agent] Content ${contentId} not found`)
    return
  }

  if (item.status !== 'approved') return

  // Load campaign posting_strategy (null if migration not run or no research task)
  const postingStrategy = await getCampaignPostingStrategy(item.campaign_id)

  if (postingStrategy?.platform_windows) {
    const platforms = Object.keys(postingStrategy.platform_windows)
    console.log(`[scheduler-agent] Using research-backed posting strategy — platforms: ${platforms.join(', ')}`)
  } else {
    console.log(`[scheduler-agent] No posting strategy found for campaign ${item.campaign_id} — using fallback hours`)
  }

  const options = await buildScheduleOptions(item.platform, item.product, postingStrategy)

  // ── Provisional reservation ───────────────────────────────────────────────
  // Write the first option back to content_log immediately so that other
  // suggestSchedule calls in the same campaign (e.g. 5-post batch) see this
  // date as taken and pick different days. executeSchedule will overwrite
  // this with the user's actual choice.
  if (options.length > 0) {
    await supabase
      .from('content_log')
      .update({ scheduled_for: options[0].toISOString() })
      .eq('id', contentId)
      .eq('status', 'approved') // guard: only update if still in approved state
  }

  if (!slackClient || !channelId) {
    console.warn('[scheduler-agent] No Slack client — skipping schedule suggestion')
    return
  }

  await slackClient.chat.postMessage({
    channel: channelId,
    text:    `📅 When should this ${PLATFORM_LABELS[item.platform] ?? item.platform} post go out?`,
    blocks:  scheduleOptionsBlocks({
      contentId: item.id,
      platform:  item.platform,
      product:   item.product,
      options,
    }),
  })
}

/**
 * Step 2 — Called when the user clicks a schedule option button.
 * Commits the chosen slot to Zernio, updates DB, confirms in Slack.
 * executeSchedule is intentionally NOT changed — the user's explicit
 * choice always wins regardless of the provisional reservation.
 *
 * @param {string} contentId
 * @param {Date}   scheduledAt  - The chosen slot
 * @param {string} channelId
 * @param {string} messageTs    - ts of the slot-picker message (to replace it)
 * @param {object} slackClient
 */
export async function executeSchedule({ contentId, scheduledAt, channelId, messageTs, slackClient }) {
  console.log(`[scheduler-agent] Executing schedule for ${contentId} at ${scheduledAt.toISOString()}`)

  const { data: item, error } = await supabase
    .from('content_log')
    .select('*')
    .eq('id', contentId)
    .single()

  if (error || !item) throw new Error(`Content ${contentId} not found`)
  if (item.status !== 'approved') {
    console.warn(`[scheduler-agent] ${contentId} is no longer approved (status: ${item.status}) — skipping`)
    return
  }

  const platform = item.platform
  const imageUrl = item.metadata?.image_url ?? null
  let   zernioPostId = null

  if (platform && process.env.ZERNIO_API_KEY) {
    try {
      const text   = buildPostText(item.output, item.metadata ?? {}, platform)
      const result = await schedulePost({ platform, content: text, scheduledAt, imageUrl: imageUrl ?? undefined })
      zernioPostId = result?._id ?? result?.id ?? result?.posts?.[0]?._id ?? result?.posts?.[0]?.id ?? result?.data?._id ?? result?.data?.id ?? null
      console.log(`[scheduler-agent] Zernio scheduled: ${zernioPostId}`)
    } catch (err) {
      console.error(`[scheduler-agent] Zernio error: ${err.message}`)
      await notifyFailed({
        item, channelId, slackClient, messageTs,
        reason: `Zernio returned an error.\n\n*Error:* ${err.message}`,
      })
      await supabase.from('content_log').update({ status: 'failed' }).eq('id', contentId)
      return
    }
  }

  await supabase
    .from('content_log')
    .update({
      status:         'scheduled',
      zernio_post_id: zernioPostId,
      scheduled_for:  scheduledAt.toISOString(),
      metadata:       { ...(item.metadata ?? {}), zernio_id: zernioPostId },
    })
    .eq('id', contentId)

  await promoteToAssetLibrary(contentId)

  if (slackClient && channelId && messageTs) {
    try {
      await slackClient.chat.update({
        channel: channelId,
        ts:      messageTs,
        text:    `✅ ${PLATFORM_LABELS[platform] ?? platform} post scheduled`,
        blocks:  scheduleConfirmedBlocks({ platform, scheduledAt, hasImage: !!imageUrl }),
      })
    } catch (err) {
      console.error(`[scheduler-agent] Failed to update Slack message: ${err.message}`)
    }
  }

  console.log(`[scheduler-agent] ${contentId} scheduled for ${scheduledAt.toISOString()}`)
}

// ── Smart slot calculation ───────────────────────────────────────────────────

/**
 * Returns 3 Date options, starting from tomorrow, skipping days that already
 * have a scheduled (or provisionally reserved) post for the same
 * platform/product.
 *
 * Time-of-day is driven by the campaign's research-backed posting_strategy:
 *   - platform_windows[platform] provides UTC hours in priority order
 *   - Each of the 3 options cycles through those hours so they differ
 *   - Falls back to PRIME_HOUR constants when no strategy is present
 *
 * @param {string}      platform
 * @param {string}      product
 * @param {object|null} postingStrategy  - from campaign_log.posting_strategy
 */
async function buildScheduleOptions(platform, product, postingStrategy) {
  const platformKey    = platform?.toLowerCase()
  const strategyHours  = postingStrategy?.platform_windows?.[platformKey]
  const preferredHours = Array.isArray(strategyHours) && strategyHours.length > 0
    ? strategyHours
    : [PRIME_HOUR[platformKey] ?? 14]

  console.log(`[scheduler-agent] Preferred hours for ${platform}: ${preferredHours.join(', ')} UTC (${postingStrategy ? 'strategy' : 'fallback'})`)

  // Query approved+pending items with scheduled_for set (includes provisional
  // reservations written by earlier suggestSchedule calls in the same campaign)
  const windowEnd = new Date()
  windowEnd.setDate(windowEnd.getDate() + 30)

  const { data: existing } = await supabase
    .from('content_log')
    .select('scheduled_for')
    .eq('platform', platform)
    .eq('product', product)
    .in('status', ['scheduled', 'approved', 'pending'])
    .not('scheduled_for', 'is', null)
    .gte('scheduled_for', new Date().toISOString())
    .lte('scheduled_for', windowEnd.toISOString())

  // Build a set of already-used UTC date strings (YYYY-MM-DD)
  const usedDays = new Set(
    (existing ?? [])
      .map(r => r.scheduled_for)
      .filter(Boolean)
      .map(iso => iso.substring(0, 10))
  )

  console.log(`[scheduler-agent] Days already taken for ${platform}: ${[...usedDays].join(', ') || 'none'}`)

  // Walk forward from tomorrow, collecting 3 free days.
  // Each slot cycles through preferredHours so options fall at different times.
  const options = []
  const cursor  = new Date()
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  cursor.setUTCMinutes(0, 0, 0)

  while (options.length < 3) {
    const dayKey = cursor.toISOString().substring(0, 10)
    if (!usedDays.has(dayKey)) {
      const hour = preferredHours[options.length % preferredHours.length]
      const slot = new Date(cursor)
      slot.setUTCHours(hour, 0, 0, 0)
      options.push(slot)
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  console.log(`[scheduler-agent] Generated options: ${options.map(d => d.toISOString()).join(' | ')}`)
  return options
}

// ── Failure notification ─────────────────────────────────────────────────────

async function notifyFailed({ item, channelId, slackClient, messageTs, reason }) {
  if (!slackClient || !channelId) return
  const platLabel = PLATFORM_LABELS[item.platform] ?? item.platform ?? 'post'
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `⚠️ *Unable to schedule ${platLabel} post*\n\n${reason}` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Content ID: \`${item.id}\`` }],
    },
  ]
  try {
    if (messageTs) {
      await slackClient.chat.update({ channel: channelId, ts: messageTs, text: `⚠️ Scheduling failed`, blocks })
    } else {
      await slackClient.chat.postMessage({ channel: channelId, text: `⚠️ Scheduling failed`, blocks })
    }
  } catch (err) {
    console.error(`[scheduler-agent] Failed to send failure notification: ${err.message}`)
  }
}
