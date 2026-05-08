export default function handler(req, res) {
  res.json({ ok: true, node: process.version, env: !!process.env.SUPABASE_URL })
}
