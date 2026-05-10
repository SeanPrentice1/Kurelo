/**
 * Zernio API client — social scheduling, analytics, and inbox.
 *
 * Auth:   Authorization: Bearer ZERNIO_API_KEY
 * Base:   https://zernio.com/api/v1
 *
 * Media is passed as a direct public URL — no presigned upload step.
 */

const BASE_URL = 'https://zernio.com/api/v1'

function headers() {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error('ZERNIO_API_KEY is not set')
  return {
    'Authorization':  `Bearer ${key}`,
    'Content-Type':   'application/json',
  }
}

// ── Account resolution ───────────────────────────────────────────────────────

/**
 * Returns all connected social accounts from Zernio.
 */
export async function getAccounts() {
  const res = await fetch(`${BASE_URL}/accounts`, { headers: headers() })
  if (!res.ok) throw new Error(`Zernio getAccounts failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  // Handle both array and wrapped responses
  return Array.isArray(data) ? data : (data.data ?? data.accounts ?? data.profiles ?? [])
}

/**
 * Resolves a platform name to an accountId.
 * Throws if no connected account is found for that platform.
 */
export async function resolveAccountId(platform) {
  const accounts = await getAccounts()
  console.log('[zernio] accounts response:', JSON.stringify(accounts).substring(0, 500))

  const match = accounts.find(
    a => (a.platform ?? a.type ?? a.network ?? '').toLowerCase() === platform.toLowerCase()
  )
  if (!match) throw new Error(`No Zernio account connected for platform: ${platform}. Available: ${accounts.map(a => a.platform ?? a.type ?? a.network ?? JSON.stringify(a)).join(', ')}`)

  // Try all known field names Zernio might use for the account identifier
  const accountId = match.accountId ?? match.id ?? match._id ?? match.profileId ?? match.socialAccountId ?? match.social_account_id
  console.log('[zernio] resolved account:', JSON.stringify(match).substring(0, 200))
  if (!accountId) throw new Error(`Zernio account for ${platform} found but accountId field is missing. Keys: ${Object.keys(match).join(', ')}`)
  return accountId
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/**
 * Schedule a post via Zernio.
 *
 * Media (if any) is passed as a direct public URL — Zernio fetches it itself.
 * No upload step required.
 *
 * @param {object}  opts
 * @param {string}  opts.platform     - e.g. 'instagram', 'linkedin', 'twitter', 'tiktok'
 * @param {string}  opts.content      - Post text
 * @param {Date}    opts.scheduledAt  - When to publish (UTC)
 * @param {string}  [opts.imageUrl]   - Public image URL to attach (optional)
 */
export async function schedulePost({ platform, content, scheduledAt, imageUrl }) {
  const accountId  = await resolveAccountId(platform)
  const mediaItems = imageUrl ? [{ type: 'IMAGE', url: imageUrl }] : []

  const body = {
    platforms:    [{ platform: platform.toLowerCase(), accountId }],
    content,
    scheduledFor: scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt,
    ...(mediaItems.length ? { mediaItems } : {}),
  }

  const res = await fetch(`${BASE_URL}/posts`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Zernio schedulePost failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── Analytics ────────────────────────────────────────────────────────────────

/**
 * Fetch posting history and performance data from Zernio.
 *
 * @param {string} [platform]  - Filter by platform (optional)
 * @param {number} [days=30]   - Lookback window in days
 */
export async function getAnalytics({ platform, days = 30 } = {}) {
  const params = new URLSearchParams({ days: String(days) })
  if (platform) params.set('platform', platform)

  const res = await fetch(`${BASE_URL}/analytics?${params}`, { headers: headers() })
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
 */
export async function getInboxMessages({ platform, type, limit = 50, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (platform) params.set('platform', platform)
  if (type)     params.set('type', type)
  if (cursor)   params.set('cursor', cursor)

  const res = await fetch(`${BASE_URL}/inbox?${params}`, { headers: headers() })
  if (!res.ok) throw new Error(`Zernio getInboxMessages failed: ${res.status} ${await res.text()}`)

  const data = await res.json()
  return {
    items:      data.items      ?? data.data  ?? [],
    nextCursor: data.nextCursor ?? data.next  ?? null,
  }
}

// ── Text helpers ─────────────────────────────────────────────────────────────

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
