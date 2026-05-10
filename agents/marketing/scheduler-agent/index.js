import { promoteToAssetLibrary } from '../../tools/memory.js'
import { schedulePost, uploadMediaFromUrl, buildPostText } from '../../tools/postfast.js'
import supabase from '../../tools/supabase.js'

/**
 * Called after a content item is approved via Slack or web dashboard.
 *
 * APPROVAL GATE — non-negotiable:
 * Only content with status 'approved' (set by a confirmed Slack approval interaction)
 * is ever passed to PostFast. Pending or rejected content is never queued.
 *
 * IMAGE GATE — non-negotiable:
 * If the approved post includes a generated image, it must be included in the
 * scheduled post. If the image upload to PostFast fails, scheduling is halted
 * and the user is notified via Slack. The post is NEVER downgraded to text-only.
 */
export async function scheduleApprovedContent({ contentId, channelId, slackClient }) {
  console.log(`[scheduler-agent] Processing approval: ${contentId}`)

  const { data: item, error } = await supabase
    .from('content_log')
    .select('*')
    .eq('id', contentId)
    .single()

  if (error || !item) throw new Error(`Content ${contentId} not found`)

  // Hard gate: only process explicitly approved content
  if (item.status !== 'approved') {
    console.warn(`[scheduler-agent] Skipping ${contentId} — status is '${item.status}', not 'approved'`)
    return { status: 'skipped', reason: `status_${item.status}` }
  }

  const platform     = item.platform
  const imageUrl     = item.metadata?.image_url ?? null
  let   postfastPostId = null

  if (platform && process.env.POSTFAST_API_KEY) {
    // If this post has an image, upload it first — never schedule without it
    let mediaItems = []
    if (imageUrl) {
      try {
        const uploaded = await uploadMediaFromUrl(imageUrl, 0)
        mediaItems = [uploaded]
        console.log(`[scheduler-agent] Image uploaded to PostFast: ${uploaded.key}`)
      } catch (err) {
        console.error(`[scheduler-agent] Image upload failed for ${contentId}: ${err.message}`)

        // Notify the user — do not schedule
        await notifyImageUploadFailed({ item, err, channelId, slackClient })

        // Mark as failed so the dashboard reflects the problem
        await supabase
          .from('content_log')
          .update({ status: 'failed' })
          .eq('id', contentId)

        return { status: 'failed', reason: 'image_upload_failed', error: err.message }
      }
    }

    try {
      const text        = buildPostText(item.output, item.metadata ?? {}, platform)
      const scheduledAt = chooseScheduleTime(platform, item.product)

      const result = await schedulePost({
        platform,
        content:    text,
        scheduledAt,
        mediaItems,
      })

      postfastPostId = result?.id ?? result?.posts?.[0]?.id ?? null
      console.log(`[scheduler-agent] PostFast scheduled: ${postfastPostId} for ${platform}`)
    } catch (err) {
      console.error(`[scheduler-agent] PostFast scheduling failed for ${contentId}: ${err.message}`)

      await notifySchedulingFailed({ item, err, channelId, slackClient })

      await supabase
        .from('content_log')
        .update({ status: 'failed' })
        .eq('id', contentId)

      return { status: 'failed', reason: 'postfast_error', error: err.message }
    }
  }

  // Update content_log with postfast_post_id + status
  await supabase
    .from('content_log')
    .update({
      status:           'scheduled',
      postfast_post_id: postfastPostId,
      metadata:         { ...(item.metadata ?? {}), postfast_id: postfastPostId },
    })
    .eq('id', contentId)

  await promoteToAssetLibrary(contentId)

  console.log(`[scheduler-agent] Content ${contentId} scheduled`)
  return { status: 'scheduled', postfastPostId }
}

// ── Slack failure notifications ──────────────────────────────────────────────

async function notifyImageUploadFailed({ item, err, channelId, slackClient }) {
  if (!slackClient || !channelId) return
  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      text:    `⚠️ Unable to schedule approved post — image upload to PostFast failed.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *Unable to schedule post*\n\nThe approved ${item.platform} post could not be scheduled because the image failed to upload to PostFast.\n\n*Reason:* ${err.message}\n\nThe post has been marked as failed. You can find the approved content and generated image in the asset library. Please schedule it manually or contact support if this persists.`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Content ID: \`${item.id}\` — Platform: ${item.platform}` }],
        },
      ],
    })
  } catch (slackErr) {
    console.error(`[scheduler-agent] Failed to send Slack notification: ${slackErr.message}`)
  }
}

async function notifySchedulingFailed({ item, err, channelId, slackClient }) {
  if (!slackClient || !channelId) return
  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      text:    `⚠️ Unable to schedule approved post — PostFast returned an error.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *Unable to schedule post*\n\nThe approved ${item.platform} post could not be queued in PostFast.\n\n*Reason:* ${err.message}\n\nThe post has been marked as failed. Please check your PostFast account and retry manually if needed.`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Content ID: \`${item.id}\` — Platform: ${item.platform}` }],
        },
      ],
    })
  } catch (slackErr) {
    console.error(`[scheduler-agent] Failed to send Slack notification: ${slackErr.message}`)
  }
}

// ── Schedule time ────────────────────────────────────────────────────────────

function chooseScheduleTime(platform, product) {
  const now    = new Date()
  const target = new Date(now)
  target.setUTCHours(target.getUTCHours() + 24)

  if (product === 'rostura') {
    target.setUTCHours(8, 0, 0, 0)
  } else {
    switch (platform?.toLowerCase()) {
      case 'instagram':
      case 'tiktok':
        target.setUTCHours(17, 0, 0, 0)
        break
      default:
        target.setUTCHours(14, 0, 0, 0)
    }
  }

  return target
}
