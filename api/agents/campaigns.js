import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  res.setHeader('Cache-Control', 'no-store')

  try {
    // Fetch active/recent campaigns
    const { data: campaigns, error: campErr } = await supabase
      .from('campaign_log')
      .select('id, product, name, brief, status, budget_cents, spend_cents, created_at, updated_at')
      .in('status', ['planning', 'active', 'paused'])
      .order('created_at', { ascending: false })
      .limit(20)

    if (campErr) throw campErr

    if (!campaigns?.length) {
      return res.json({ ok: true, campaigns: [] })
    }

    // Fetch content stats for each campaign in one query
    const campaignIds = campaigns.map(c => c.id)
    const { data: contentRows, error: contentErr } = await supabase
      .from('content_log')
      .select('campaign_id, status, agent, task_type, platform, output, created_at, scheduled_for')
      .in('campaign_id', campaignIds)
      .order('created_at', { ascending: false })

    if (contentErr) throw contentErr

    // Group content by campaign
    const contentByCampaign = {}
    for (const row of contentRows ?? []) {
      if (!contentByCampaign[row.campaign_id]) contentByCampaign[row.campaign_id] = []
      contentByCampaign[row.campaign_id].push(row)
    }

    const result = campaigns.map(camp => {
      const items = contentByCampaign[camp.id] ?? []
      return {
        ...camp,
        budget_usd: camp.budget_cents != null ? camp.budget_cents / 100 : null,
        spend_usd:  camp.spend_cents  != null ? camp.spend_cents  / 100 : null,
        content: {
          total:     items.length,
          pending:   items.filter(i => i.status === 'pending').length,
          approved:  items.filter(i => i.status === 'approved').length,
          rejected:  items.filter(i => i.status === 'rejected').length,
          scheduled: items.filter(i => i.status === 'scheduled').length,
          posted:    items.filter(i => i.status === 'posted').length,
          items,
        },
      }
    })

    res.json({ ok: true, campaigns: result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}
