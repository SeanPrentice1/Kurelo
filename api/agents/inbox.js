import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  res.setHeader('Cache-Control', 'no-store')

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var' })
  }

  try {
    const { data: items, error } = await supabase
      .from('content_log')
      .select('id, campaign_id, product, agent, task_type, platform, content_type, output, metadata, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    if (!items?.length) return res.json({ ok: true, items: [] })

    // Fetch campaign names separately — guard against empty array which PostgREST rejects
    const campaignIds = [...new Set(items.map(i => i.campaign_id).filter(Boolean))]
    const campaignMap = {}
    if (campaignIds.length > 0) {
      const { data: campaigns } = await supabase
        .from('campaign_log')
        .select('id, name')
        .in('id', campaignIds)
      for (const c of campaigns ?? []) campaignMap[c.id] = c
    }

    const result = items.map(item => ({
      ...item,
      campaign_log: campaignMap[item.campaign_id] ?? null,
    }))

    res.json({ ok: true, items: result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}
