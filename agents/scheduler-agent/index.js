import { promoteToAssetLibrary } from '../tools/memory.js'
import { schedulePost, buildPostText } from '../tools/postfast.js'
import supabase from '../tools/supabase.js'

/**
 * Called after a content item is approved (via Slack or web dashboard).
 * Schedules the post via PostFast, marks it as scheduled, and promotes
 * it to the asset library.
 */
export async function scheduleApprovedContent({ contentId }) {
  console.log(`[scheduler-agent] Processing approval: ${contentId}`)

  const { data: item, error } = await supabase
    .from('content_log')
    .select('*')
    .eq('id', contentId)
    .single()

  if (error || !item) throw new Error(`Content ${contentId} not found`)

  const platform = item.platform
  let postfastId  = null

  if (platform && process.env.POSTFAST_API_KEY) {
    try {
      const text        = buildPostText(item.output, item.metadata ?? {}, platform)
      const scheduledAt = chooseScheduleTime(platform, item.product)

      const result = await schedulePost({ platform, content: text, scheduledAt })
      postfastId   = result?.id ?? result?.posts?.[0]?.id ?? null

      console.log(`[scheduler-agent] PostFast scheduled: ${postfastId} for ${platform}`)
    } catch (err) {
      // Non-fatal — still mark as scheduled so it shows in dashboard
      console.error(`[scheduler-agent] PostFast error (continuing): ${err.message}`)
    }
  }

  await supabase
    .from('content_log')
    .update({
      status:   'scheduled',
      metadata: { ...(item.metadata ?? {}), postfast_id: postfastId },
    })
    .eq('id', contentId)

  await promoteToAssetLibrary(contentId)

  console.log(`[scheduler-agent] Content ${contentId} scheduled`)
  return { status: 'scheduled', postfastId }
}

/**
 * Pick the next optimal posting time for a given platform and product.
 * Rostura targets Australian business hours (AEDT = UTC+10/+11).
 * Crevaxo targets photographers / business professionals globally.
 */
function chooseScheduleTime(platform, product) {
  const now    = new Date()
  const target = new Date(now)

  // Schedule ~24 hours out so it lands at peak time on the next day
  target.setUTCHours(target.getUTCHours() + 24)

  if (product === 'rostura') {
    // AEDT peak: 7–8 PM local = 08:00–09:00 UTC (AEDT UTC+11 in summer, UTC+10 in winter)
    target.setUTCHours(8, 0, 0, 0)
  } else {
    // Crevaxo: global audience — 9 AM US-East = 14:00 UTC
    switch (platform?.toLowerCase()) {
      case 'instagram':
      case 'tiktok':
        target.setUTCHours(17, 0, 0, 0) // 6 PM AEST / 1 PM London / 8 AM NY
        break
      default:
        target.setUTCHours(14, 0, 0, 0) // 9 AM US-East
    }
  }

  return target
}
