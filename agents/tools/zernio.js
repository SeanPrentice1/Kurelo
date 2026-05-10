/**
 * Zernio API client — social scheduling, media upload, analytics, and inbox.
 * Drop-in replacement for the previous PostFast integration.
 * Auth: zernio-api-key header + ZERNIO_API_KEY env var.
 */

const BASE_URL = 'https://api.zernio.com'

function headers() {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error('ZERNIO_API_KEY is not set')
  return { 'zernio-api-key': key, 'Content-Type': 'application/json' }
}

function authHeaders() {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error('ZERNIO_API_KEY is not set')
  return { 'zernio-api-key': key }
}

// ── Media upload ─────────────────────────────────────────────────────────────

/**
 * Download an image from a public URL and upload it to Zernio via the
 * presigned S3 flow:
 *   1. POST /file/get-signed-upload-urls  → [{ key, signedUrl }]
 *   2. PUT  signedUrl                     → upload bytes directly to S3
 *
 * Returns { type, key, sortOrder } ready for use in mediaItems.
 * THROWS on failure — callers decide how to handle it.
 */
export async function uploadMediaFromUrl(publicUrl, sortOrder = 0) {
  // 1. Download the image from Supabase storage
  const imageRes = await fetch(publicUrl)
  if (!imageRes.ok) throw new Error(`Failed to download image from storage: ${imageRes.status}`)
  const buffer      = Buffer.from(await imageRes.arrayBuffer())
  const contentType = imageRes.headers.get('content-type') ?? 'image/png'

  // 2. Request a presigned S3 upload URL from Zernio
  const signedRes = await fetch(`${BASE_URL}/file/get-signed-upload-urls`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ contentType, count: 1 }),
  })
  if (!signedRes.ok) {
    const text = await signedRes.text()
    throw new Error(`Zernio get-signed-upload-urls failed: ${signedRes.status} ${text}`)
  }
  const signedData = await signedRes.json()
  const { key, signedUrl } = Array.isArray(signedData) ? signedData[0] : signedData
  if (!key || !signedUrl) {
    throw new Error(`Zernio signed URL response missing key/signedUrl: ${JSON.stringify(signedData)}`)
  }

  // 3. PUT the image bytes directly to S3 via the presigned URL
  const s3Res = await fetch(signedUrl, {
    method:  'PUT',
    headers: { 'Content-Type': contentType },
    body:    buffer,
  })
  if (!s3Res.ok) throw new Error(`S3 presigned upload failed: ${s3Res.status}`)

  const type = key.startsWith('video/') ? 'VIDEO' : 'IMAGE'
  console.log(`[zernio] Media uploaded: ${key}`)
  return { type, key, sortOrder }
}

// ── Account resolution ───────────────────────────────────────────────────────

/**
 * Returns all connected social accounts.
 */
export async function getAccounts() {
  const res = await fetch(`${BASE_URL}/social-media/my-social-accounts`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Zernio getAccounts failed: ${res.status} ${await res.text()}`)
  return res.json()
}

/**
 * Resolves a platform name to a socialMediaId.
 * Throws if no connected account is found for that platform.
 */
export async function resolveSocialMediaId(platform) {
  const accounts = await getAccounts()
  const match = accounts.find(
    a => a.platform?.toLowerCase() === platform.toLowerCase()
  )
  if (!match) throw new Error(`No Zernio account connected for platform: ${platform}`)
  return match.id
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/**
 * Schedule a post via Zernio.
 *
 * @param {object}   opts
 * @param {string}   opts.platform     - e.g. 'instagram', 'linkedin', 'twitter', 'tiktok'
 * @param {string}   opts.content      - Post text
 * @param {Date}     opts.scheduledAt  - When to publish (UTC)
 * @param {object[]} [opts.mediaItems] - Pre-uploaded media: [{ type, key, sortOrder }]
 */
export async function schedulePost({ platform, content, scheduledAt, mediaItems = [] }) {
  const socialMediaId = await resolveSocialMediaId(platform)
  const controls      = buildControls(platform)

  const body = {
    posts: [
      {
        content,
        scheduledAt: scheduledAt.toISOString(),
        socialMediaId,
        ...(mediaItems.length ? { mediaItems } : {}),
      },
    ],
    ...(Object.keys(controls).length ? { controls } : {}),
  }

  const res = await fetch(`${BASE_URL}/social-posts`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Zernio schedulePost failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── Analytics ────────────────────────────────────────────────────────────────

/**
 * Fetch posting history and performance data from Zernio analytics.
 *
 * @param {string} [platform]  - Filter by platform (optional)
 * @param {number} [days=30]   - Lookback window in days
 * @returns {object} Analytics payload from Zernio
 */
export async function getAnalytics({ platform, days = 30 } = {}) {
  const params = new URLSearchParams({ days: String(days) })
  if (platform) params.set('platform', platform)

  const res = await fetch(`${BASE_URL}/analytics?${params}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Zernio getAnalytics failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── Inbox monitoring ─────────────────────────────────────────────────────────

/**
 * Pull comments and DMs from Zernio's unified inbox.
 * Available for future use — not wired to any agent yet.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.platform]  - Filter to a specific platform
 * @param {string}  [opts.type]      - 'comment' | 'dm' | undefined (all)
 * @param {number}  [opts.limit=50]  - Max items to return
 * @param {string}  [opts.cursor]    - Pagination cursor from previous response
 * @returns {{ items: object[], nextCursor: string|null }}
 */
export async function getInboxMessages({ platform, type, limit = 50, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (platform) params.set('platform', platform)
  if (type)     params.set('type', type)
  if (cursor)   params.set('cursor', cursor)

  const res = await fetch(`${BASE_URL}/inbox?${params}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Zernio getInboxMessages failed: ${res.status} ${await res.text()}`)

  const data = await res.json()
  return {
    items:      data.items      ?? data.data     ?? [],
    nextCursor: data.nextCursor ?? data.next      ?? null,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Format output + metadata into a platform-ready post string.
 */
export function buildPostText(output, metadata = {}, platform) {
  const parts = [output.trim()]

  if (metadata.hashtags?.length && platform !== 'linkedin') {
    parts.push(metadata.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' '))
  }

  return parts.filter(Boolean).join('\n\n')
}
