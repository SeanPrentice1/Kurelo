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

// Fallback prime posting times per platform (UTC hours) used ONLY when no
// campaign posting_strategy exists (i.e. the campaign had no research task).
const FALLBACK_HOUR = {
  instagram:  17,
  tiktok:     17,
  twitter:    14,
  linkedin:   14,
  reddit:     15,
  meta_ads:   14,
  google_ads: 14,
}

const DAY_OF_WEEK = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
}

/**
 * Step 1 — Called immediately after content is approved.
 *
 * Fetches the campaign's research-backed posting_strategy. The strategy
 * contains an ordered list of recommended {day, utc_hour} slots per platform.
 * The scheduler works through those slots in priority order, skipping any
 * exact day+time combos already taken by another post.
 *
 * Two posts on the same day at different hours are explicitly valid — the
 * research agent may recommend e.g. Tuesday 12:00 and Tuesday 17:00 as
 * independent high-engagement windows.
 *
 * A provisional scheduled_for is written back to content_log immediately
 * so that concurrent suggestSchedule calls for a multi-post campaign each
 * see the previous reservations and receive distinct slots.
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

  const postingStrategy = await getCampaignPostingStrategy(item.campaign_id)

  if (postingStrategy?.platform_windows?.[item.platform?.toLowerCase()]) {
    console.log(`[scheduler-agent] Using research-backed posting strategy for ${item.platform}`)
  } else {
    console.log(`[scheduler-agent] No strategy for ${item.platform} in campaign ${item.campaign_id} — using fallback`)
  }

  const options = await buildScheduleOptions(item.platform, item.product, postingStrategy)

  // Provisional reservation — write the first suggested slot back to content_log
  // so that other suggestSchedule calls in this campaign see it as taken.
  // executeSchedule will overwrite this with the user's confirmed choice.
  if (options.length > 0) {
    await supabase
      .from('content_log')
      .update({ scheduled_for: options[0].toISOString() })
      .eq('id', contentId)
      .eq('status', 'approved')
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
 * Commits the chosen slot to Zernio, updates the DB, confirms in Slack.
 * Not modified — the user's explicit choice always wins.
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

// ── Slot calculation ─────────────────────────────────────────────────────────

/**
 * Returns 3 Date options driven entirely by the research agent's posting_strategy.
 *
 * The strategy supplies an ordered list of {day, utc_hour} slots per platform
 * (e.g. [{day:'tuesday',utc_hour:17},{day:'tuesday',utc_hour:20},{day:'thursday',utc_hour:12}]).
 * Starting from tomorrow, the scheduler walks forward day by day and checks
 * each calendar day against the strategy's recommendations for that day-of-week.
 * When a recommended slot is free it is offered; when it is taken (exact day+hour
 * collision) it is skipped and the next recommended slot is tried instead.
 *
 * Two posts on the same day at different hours are explicitly valid — the
 * research agent decides whether that is appropriate for the audience.
 *
 * Falls back to a simple day-walk at the platform's prime hour when no
 * strategy is present (campaigns without a research task).
 */
async function buildScheduleOptions(platform, product, postingStrategy) {
  const platformKey  = platform?.toLowerCase()
  const rawSlots     = postingStrategy?.platform_windows?.[platformKey]

  // Parse strategy slots into [{dayOfWeek: 0-6, utc_hour: 0-23}] in priority order
  const strategySlots = parseStrategySlots(rawSlots)

  // Fetch all content for this platform/product that already has a scheduled_for
  // (covers confirmed, provisionally reserved, and legacy approved rows)
  const windowEnd = new Date()
  windowEnd.setDate(windowEnd.getDate() + 90)

  const { data: existing } = await supabase
    .from('content_log')
    .select('scheduled_for')
    .eq('platform', platform)
    .eq('product', product)
    .in('status', ['scheduled', 'approved', 'pending'])
    .not('scheduled_for', 'is', null)
    .gte('scheduled_for', new Date().toISOString())
    .lte('scheduled_for', windowEnd.toISOString())

  // Taken slots keyed as "YYYY-MM-DDTHH" (day+hour precision so two posts on
  // the same day at different times don't conflict with each other)
  const takenSlots = new Set(
    (existing ?? [])
      .map(r => r.scheduled_for)
      .filter(Boolean)
      .map(isoToSlotKey)
  )

  if (strategySlots.length === 0) {
    console.log(`[scheduler-agent] No strategy slots for ${platform} — using fallback hour`)
    return buildFallbackOptions(platformKey, takenSlots)
  }

  console.log(`[scheduler-agent] Strategy has ${strategySlots.length} recommended slots for ${platform}`)
  console.log(`[scheduler-agent] Already taken: ${[...takenSlots].join(', ') || 'none'}`)

  // Walk forward day by day from tomorrow, checking strategy recommendations
  const options = []
  const cursor  = new Date()
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  cursor.setUTCHours(0, 0, 0, 0)

  for (let day = 0; day < 90 && options.length < 3; day++) {
    const curDayOfWeek = cursor.getUTCDay()
    const dateStr      = cursor.toISOString().substring(0, 10)

    // Collect all strategy-recommended slots for this day of week, in priority order
    for (const slot of strategySlots) {
      if (options.length >= 3) break
      if (slot.dayOfWeek !== curDayOfWeek) continue

      const slotKey = `${dateStr}T${String(slot.utc_hour).padStart(2, '0')}`
      if (!takenSlots.has(slotKey)) {
        const d = new Date(cursor)
        d.setUTCHours(slot.utc_hour, 0, 0, 0)
        options.push(d)
        takenSlots.add(slotKey) // prevent offering the same slot twice within this call
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  console.log(`[scheduler-agent] Generated ${options.length} options: ${options.map(d => d.toISOString()).join(' | ')}`)
  return options
}

/**
 * Parse whatever the research agent returned into a normalised slot list.
 * Accepts the new {day, utc_hour} object format.
 * Returns [] if input is missing, malformed, or in an unrecognised format.
 */
function parseStrategySlots(rawSlots) {
  if (!Array.isArray(rawSlots) || rawSlots.length === 0) return []

  const slots = []
  for (const s of rawSlots) {
    if (typeof s === 'object' && s !== null && typeof s.day === 'string' && typeof s.utc_hour === 'number') {
      const dayOfWeek = DAY_OF_WEEK[s.day.toLowerCase()]
      if (dayOfWeek !== undefined && s.utc_hour >= 0 && s.utc_hour <= 23) {
        slots.push({ dayOfWeek, utc_hour: s.utc_hour })
      }
    }
  }
  return slots
}

/**
 * Fallback when no strategy is available. Offers 3 upcoming days at the
 * platform's prime hour, skipping exact day+hour collisions.
 */
function buildFallbackOptions(platformKey, takenSlots) {
  const hour    = FALLBACK_HOUR[platformKey] ?? 14
  const options = []
  const cursor  = new Date()
  cursor.setUTCDate(cursor.getUTCDate() + 1)

  while (options.length < 3) {
    const dateStr = cursor.toISOString().substring(0, 10)
    const slotKey = `${dateStr}T${String(hour).padStart(2, '0')}`
    if (!takenSlots.has(slotKey)) {
      const d = new Date(cursor)
      d.setUTCHours(hour, 0, 0, 0)
      options.push(d)
      takenSlots.add(slotKey)
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return options
}

/** "2025-06-10T17:00:00.000Z" → "2025-06-10T17" */
function isoToSlotKey(iso) {
  const d = new Date(iso)
  return `${iso.substring(0, 10)}T${String(d.getUTCHours()).padStart(2, '0')}`
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
