// Sends emails via Resend.
// Required env vars:
//   RESEND_API_KEY
//
// POST body: { to: string[], from: string, subject: string, html: string }
//   to:      array of recipient email addresses (caller handles group filtering)
//   from:    must be one of the allowed sender addresses
//   subject: email subject line
//   html:    email body HTML

const ALLOWED_FROM = ['hello@crevaxo.com', 'sean@crevaxo.com']
const RESEND_BATCH_LIMIT = 100

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' })
  }

  res.setHeader('Cache-Control', 'no-store')

  const { to, from, subject, html } = req.body

  // Validation
  if (!Array.isArray(to) || !to.length) {
    return res.status(400).json({ error: 'to must be a non-empty array of email addresses' })
  }
  if (!ALLOWED_FROM.includes(from)) {
    return res.status(400).json({ error: `from must be one of: ${ALLOWED_FROM.join(', ')}` })
  }
  if (!subject?.trim()) {
    return res.status(400).json({ error: 'subject is required' })
  }
  if (!html?.trim()) {
    return res.status(400).json({ error: 'html body is required' })
  }

  try {
    // Chunk into batches of RESEND_BATCH_LIMIT
    const chunks = []
    for (let i = 0; i < to.length; i += RESEND_BATCH_LIMIT) {
      chunks.push(to.slice(i, i + RESEND_BATCH_LIMIT))
    }

    let totalSent = 0

    for (const chunk of chunks) {
      const url    = chunk.length === 1 ? 'https://api.resend.com/emails' : 'https://api.resend.com/emails/batch'
      const body   = chunk.length === 1
        ? JSON.stringify({ from, to: chunk[0], subject, html })
        : JSON.stringify(chunk.map(email => ({ from, to: email, subject, html })))

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err.message || err.name || `Resend ${r.status}`)
      }

      totalSent += chunk.length
    }

    res.json({ success: true, sent: totalSent })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
