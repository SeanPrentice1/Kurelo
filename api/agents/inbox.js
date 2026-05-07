import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  res.setHeader('Cache-Control', 'no-store')

  try {
    const { data, error } = await supabase
      .from('content_log')
      .select(`
        id,
        product,
        agent,
        task_type,
        platform,
        content_type,
        output,
        metadata,
        status,
        created_at,
        campaign_log ( id, name )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    res.json({ ok: true, items: data ?? [] })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}
