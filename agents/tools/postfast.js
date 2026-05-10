const BASE_URL = 'https://api.postfa.st'

function headers() {
  const key = process.env.POSTFAST_API_KEY
  if (!key) throw new Error('POSTFAST_API_KEY is not set')
  return { 'pf-api-key': key, 'Content-Type': 'application/json' }
}

function authHeaders() {
  const key = process.env.POSTFAST_API_KEY
  if (!key) throw new Error('POSTFAST_API_KEY is not set')
  return { 'pf-api-key': key }
}

/**
 * Download an image from a public URL and upload it to PostFast media storage.
 * Returns { type, key, sortOrder } ready for use in mediaItems.
 * THROWS on failure — callers decide how to handle it.
 */
export async function uploadMediaFromUrl(publicUrl, sortOrder = 0) {
  // Download the image
  const imageRes = await fetch(publicUrl)
  if (!imageRes.ok) throw new Error(`Failed to download image from storage: ${imageRes.status}`)
  const buffer = Buffer.from(await imageRes.arrayBuffer())
  const contentType = imageRes.headers.get('content-type') ?? 'image/png'
  const ext = contentType.includes('jpeg') ? 'jpg' : 'png'
  const filename = `upload-${Date.now()}.${ext}`

  // Upload to PostFast
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: contentType }), filename)

  const uploadRes = await fetch(`${BASE_URL}/media`, {
    method:  'POST',
    headers: authHeaders(),
    body:    form,
  })

  if (!uploadRes.ok) {
    const text = await uploadRes.text()
    throw new Error(`PostFast media upload failed: ${uploadRes.status} ${text}`)
  }

  const data = await uploadRes.json()
  // PostFast returns { key } in format 'image/uuid.ext'
  const key = data.key ?? data.data?.key ?? null
  if (!key) throw new Error(`PostFast media upload returned no key: ${JSON.stringify(data)}`)

  const type = key.startsWith('video/') ? 'VIDEO' : 'IMAGE'
  return { type, key, sortOrder }
}

/**
 * Returns all connected social accounts.
 * Each account has: id (UUID), platform, username, etc.
 */
export async function getAccounts() {
  const res = await fetch(`${BASE_URL}/social-media/my-social-accounts`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`PostFast getAccounts failed: ${res.status} ${await res.text()}`)
  return res.json()
}

/**
 * Resolves a platform name (e.g. 'instagram', 'linkedin') to a socialMediaId.
 * Throws if no connected account is found for that platform.
 */
export async function resolveSocialMediaId(platform) {
  const accounts = await getAccounts()
  const match = accounts.find(
    a => a.platform?.toLowerCase() === platform.toLowerCase()
  )
  if (!match) throw new Error(`No PostFast account connected for platform: ${platform}`)
  return match.id
}

/**
 * Schedule a post via PostFast.
 *
 * @param {object} opts
 * @param {string} opts.platform  - e.g. 'instagram', 'linkedin', 'twitter', 'tiktok'
 * @param {string} opts.content   - Post text
 * @param {Date}   opts.scheduledAt - When to publish (UTC)
 * @param {string[]} [opts.mediaUrls] - Optional media URLs
 * @returns {object} PostFast API response
 */
/**
 * Schedule a post via PostFast.
 *
 * @param {object}   opts
 * @param {string}   opts.platform     - e.g. 'instagram', 'linkedin', 'twitter', 'tiktok'
 * @param {string}   opts.content      - Post text
 * @param {Date}     opts.scheduledAt  - When to publish (UTC)
 * @param {object[]} [opts.mediaItems] - Pre-uploaded media: [{ type, key, sortOrder }]
 */
export async function schedulePost({ platform, content, scheduledAt, mediaItems = [] }) {
  const socialMediaId = await resolveSocialMediaId(platform)

  const controls = buildControls(platform)

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

  if (!res.ok) throw new Error(`PostFast schedulePost failed: ${res.status} ${await res.text()}`)
  return res.json()
}

function buildControls(platform) {
  switch (platform.toLowerCase()) {
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
