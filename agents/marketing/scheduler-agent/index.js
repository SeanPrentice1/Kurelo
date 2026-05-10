import { promoteToAssetLibrary } from '../../tools/memory.js'
import { schedulePost, uploadMediaFromUrl, buildPostText } from '../../tools/zernio.js'
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

// Prime posting times per platform (UTC hours)
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
 * Calculates smart schedule options (avoids days already used by this
 * platform/product), then posts a slot-picker to Slack.
 * Does NOT call Zernio yet.
 */
export async function suggestSchedule({ contentId, channelId, slackClient }) {
  console.log(`[scheduler-agent] Suggesting schedule for: ${contentId}`)

  const { data: item, error } = await supabase
    .from('content_log')
    .select('id, platform, product, metadata, status')
    .eq('id', contentId)
    .single()

  if (error || !item) {
    console.error(`[scheduler-agent] Content ${contentId} not found`)
    return
  }

  if (item.status !== 'approved') return

  const options = await buildScheduleOptions(item.platform, item.product)

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
 * Uploads image (if any), commits to Zernio, updates DB, confirms in Slack.
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
    // Image gate — must upload before scheduling; never post without it
    let mediaItems = []
    if (imageUrl) {
      try {
        const uploaded = await uploadMediaFromUrl(imageUrl, 0)
        mediaItems = [uploaded]
        console.log(`[scheduler-agent] Image uploaded: ${uploaded.key}`)
      } catch (err) {
        console.error(`[scheduler-agent] Image upload failed: ${err.message}`)
        await notifyFailed({
          item, channelId, slackClient, messageTs,
          reason: `The image failed to upload to Zernio.\n\n*Error:* ${err.message}\n\nPlease schedule it manually from the asset library.`,
        })
        await supabase.from('content_log').update({ status: 'failed' }).eq('id', contentId)
        return
      }
    }

    try {
      const text   = buildPostText(item.output, item.metadata ?? {}, platform)
      const result = await schedulePost({ platform, content: text, scheduledAt, mediaItems })
      zernioPostId = result?.id ?? result?.posts?.[0]?.id ?? null
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
      status:        'scheduled',
      zernio_post_id: zernioPostId,
      scheduled_for: scheduledAt.toISOString(),
      metadata:      { ...(item.metadata ?? {}), zernio_id: zernioPostId },
    })
    .eq('id', contentId)

  await promoteToAssetLibrary(contentId)

  // Replace the slot-picker message with confirmation
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
 * Returns 3 Date options, starting from tomorrow, skipping days that
 * already have a scheduled post for the same platform.
 */
async function buildScheduleOptions(platform, product) {
  const primeHour = PRIME_HOUR[platform?.toLowerCase()] ?? 14

  // Fetch already-scheduled dates for this platform in the next 30 days
  const windowEnd = new Date()
  windowEnd.setDate(windowEnd.getDate() + 30)

  const { data: existing } = await supabase
    .from('content_log')
    .select('scheduled_for')
    .eq('platform', platform)
    .eq('product', product)
    .in('status', ['scheduled', 'approved'])
    .gte('scheduled_for', new Date().toISOString())
    .lte('scheduled_for', windowEnd.toISOString())

  // Build a set of already-used UTC date strings (YYYY-MM-DD)
  const usedDays = new Set(
    (existing ?? [])
      .map(r => r.scheduled_for)
      .filter(Boolean)
      .map(iso => iso.substring(0, 10))
  )

  // Walk forward from tomorrow, collecting 3 free days
  const options = []
  const cursor  = new Date()
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  cursor.setUTCHours(primeHour, 0, 0, 0)

  while (options.length < 3) {
    const dayKey = cursor.toISOString().substring(0, 10)
    if (!usedDays.has(dayKey)) {
      options.push(new Date(cursor))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

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
