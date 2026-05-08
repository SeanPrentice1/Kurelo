import { promoteToAssetLibrary } from '../../tools/memory.js'
import { schedulePost, buildPostText } from '../../tools/postfast.js'
import supabase from '../../tools/supabase.js'

/**
 * Called after a content item is approved via Slack or web dashboard.
 *
 * APPROVAL GATE — non-negotiable:
 * Only content with status 'approved' (set by a confirmed Slack approval interaction)
 * is ever passed to PostFast. Pending or rejected content is never queued.
 *
 * Supabase migration required:
 *   ALTER TABLE content_log ADD COLUMN IF NOT EXISTS postfast_post_id TEXT;
 */
export async function scheduleApprovedContent({ contentId }) {
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

  const platform = item.platform
  let postfastPostId = null

  if (platform && process.env.POSTFAST_API_KEY) {
    try {
      const imageUrl    = item.metadata?.image_url ?? null
      const text        = buildPostText(item.output, item.metadata ?? {}, platform)
      const scheduledAt = chooseScheduleTime(platform, item.product)

      const result = await schedulePost({
        platform,
        content:    text,
        scheduledAt,
        mediaUrls:  imageUrl ? [imageUrl] : [],
      })

      postfastPostId = result?.id ?? result?.posts?.[0]?.id ?? null
      console.log(`[scheduler-agent] PostFast scheduled: ${postfastPostId} for ${platform}`)
    } catch (err) {
      console.error(`[scheduler-agent] PostFast error (continuing): ${err.message}`)
    }
  }

  // Update content_log with dedicated postfast_post_id column + status
  await supabase
    .from('content_log')
    .update({
      status:          'scheduled',
      postfast_post_id: postfastPostId,
      metadata:        { ...(item.metadata ?? {}), postfast_id: postfastPostId },
    })
    .eq('id', contentId)

  await promoteToAssetLibrary(contentId)

  console.log(`[scheduler-agent] Content ${contentId} scheduled`)
  return { status: 'scheduled', postfastPostId }
}

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
