export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  const { password } = req.body || {}
  const expectedPassword = process.env.DASHBOARD_PASSWORD
  const sessionToken = process.env.DASHBOARD_SESSION_TOKEN

  if (!expectedPassword || !sessionToken) {
    return res.status(500).send('Dashboard environment variables not configured.')
  }

  if (password !== expectedPassword) {
    return res.redirect(302, '/dashboard/login.html?error=1')
  }

  // 7-day session
  const maxAge = 60 * 60 * 24 * 7
  res.setHeader(
    'Set-Cookie',
    `dashboard_session=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
  )
  res.redirect(302, '/dashboard')
}
