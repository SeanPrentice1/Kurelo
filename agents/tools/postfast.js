const BASE_URL = 'https://api.postfa.st'

function headers() {
  const key = process.env.POSTFAST_API_KEY
  if (!key) throw new Error('POSTFAST_API_KEY is not set')
  return { 'pf-api-key': key, 'Content-Type': 'application/json' }
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
export async function schedulePost({ platform, content, scheduledAt, mediaUrls = [] }) {
  const socialMediaId = await resolveSocialMediaId(platform)

  const controls = buildControls(platform)

  const mediaItems = mediaUrls.map(url => ({ url }))

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
