// Calls the kurelo-dashboard Supabase Edge Function in the Crevaxo project.
// Required env vars:
//   CREVAXO_SUPABASE_FUNCTION_URL  e.g. https://xyz.supabase.co/functions/v1/kurelo-dashboard
//   KURELO_DASHBOARD_SECRET        shared secret set in both Vercel + Supabase

export default async function handler(req, res) {
  const fnUrl    = process.env.CREVAXO_SUPABASE_FUNCTION_URL
  const secret   = process.env.KURELO_DASHBOARD_SECRET

  if (!fnUrl || !secret) {
    return res.json({ configured: false })
  }

  res.setHeader('Cache-Control', 'no-store')

  try {
    const response = await fetch(fnUrl, {
      method: 'GET',
      headers: {
        'x-kurelo-key': secret,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Crevaxo API ${response.status}: ${text}`)
    }

    const data = await response.json()
    res.json({ configured: true, ...data })
  } catch (err) {
    res.status(500).json({ configured: true, error: err.message })
  }
}
