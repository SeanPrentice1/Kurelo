import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  res.setHeader('Cache-Control', 'no-store')

  const { contentId, reason } = req.body ?? {}
  if (!contentId) return res.status(400).json({ error: 'contentId required' })

  const { data: item, error: fetchErr } = await supabase
    .from('content_log')
    .select('campaign_id, status')
    .eq('id', contentId)
    .single()

  if (fetchErr || !item) return res.status(404).json({ error: 'Content not found' })
  if (item.status !== 'pending') return res.status(409).json({ error: `Content is already ${item.status}` })

  await supabase
    .from('content_log')
    .update({ status: 'rejected' })
    .eq('id', contentId)

  await supabase.from('decisions_log').insert({
    content_id:  contentId,
    campaign_id: item.campaign_id,
    decision:    'rejected',
    decided_by:  'web',
    reason:      reason ?? null,
  })

  res.json({ ok: true, status: 'rejected' })
}
