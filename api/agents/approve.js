import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://api.postfa.st'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  res.setHeader('Cache-Control', 'no-store')

  const { contentId } = req.body ?? {}
  if (!contentId) return res.status(400).json({ error: 'contentId required' })

  const { data: item, error: fetchErr } = await supabase
    .from('content_log')
    .select('campaign_id, status, product, content_type, output, platform, agent, metadata')
    .eq('id', contentId)
    .single()

  if (fetchErr || !item) return res.status(404).json({ error: 'Content not found' })
  if (item.status !== 'pending') return res.status(409).json({ error: `Content is already ${item.status}` })

  // Schedule via PostFast (non-fatal if it fails — content still gets approved)
  let postfastId = null
  if (item.platform && process.env.POSTFAST_API_KEY) {
    try {
      postfastId = await postfastSchedule(item)
    } catch (err) {
      console.error('[approve] PostFast error (continuing):', err.message)
    }
  }

  await supabase
    .from('content_log')
    .update({
      status:      'scheduled',
      approved_at: new Date().toISOString(),
      approved_by: 'web',
      metadata:    { ...(item.metadata ?? {}), postfast_id: postfastId },
    })
    .eq('id', contentId)

  await supabase.from('decisions_log').insert({
    content_id:  contentId,
    campaign_id: item.campaign_id,
    decision:    'approved',
    decided_by:  'web',
  })

  await supabase.from('asset_library').insert({
    product:    item.product,
    asset_type: item.content_type,
    title:      `${item.platform ?? item.agent} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    content:    item.output,
    platform:   item.platform,
    metadata:   { ...(item.metadata ?? {}), postfast_id: postfastId },
  })

  return res.json({ ok: true, status: 'scheduled', postfastId })
}

async function postfastSchedule(item) {
  // Resolve socialMediaId for this platform
  const accountsRes = await fetch(`${BASE_URL}/social-media/my-social-accounts`, {
    headers: { 'pf-api-key': process.env.POSTFAST_API_KEY },
  })
  if (!accountsRes.ok) throw new Error(`PostFast accounts fetch failed: ${accountsRes.status}`)
  const accounts = await accountsRes.json()

  const account = accounts.find(
    a => a.platform?.toLowerCase() === item.platform?.toLowerCase()
  )
  if (!account) throw new Error(`No PostFast account for platform: ${item.platform}`)

  const content = buildPostText(item.output, item.metadata ?? {}, item.platform)
  const scheduledAt = chooseScheduleTime(item.platform, item.product)
  const controls    = buildControls(item.platform)

  const body = {
    posts: [{ content, scheduledAt: scheduledAt.toISOString(), socialMediaId: account.id }],
    ...(Object.keys(controls).length ? { controls } : {}),
  }

  const postRes = await fetch(`${BASE_URL}/social-posts`, {
    method:  'POST',
    headers: { 'pf-api-key': process.env.POSTFAST_API_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!postRes.ok) throw new Error(`PostFast schedule failed: ${postRes.status} ${await postRes.text()}`)

  const data = await postRes.json()
  return data?.id ?? data?.posts?.[0]?.id ?? null
}

function buildPostText(output, metadata, platform) {
  const parts = [output.trim()]
  if (metadata.hashtags?.length && platform !== 'linkedin') {
    parts.push(metadata.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' '))
  }
  return parts.filter(Boolean).join('\n\n')
}

function chooseScheduleTime(platform, product) {
  const target = new Date()
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

function buildControls(platform) {
  switch (platform?.toLowerCase()) {
    case 'instagram':
      return { instagramPublishType: 'TIMELINE', instagramPostToGrid: true }
    case 'tiktok':
      return { tiktokPrivacy: 'PUBLIC', tiktokAllowComments: true }
    default:
      return {}
  }
}
