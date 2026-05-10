const BASE_URL = 'https://api.postfa.st'

function headers() {
  const key = process.env.POSTFAST_API_KEY
  if (!key) throw new Error('POSTFAST_API_KEY is not set')
  return { 'pf-api-key': key, 'Content-Type': 'application/json' }
}

/**
 * Download an image from a public URL and upload it to PostFast via the
 * presigned S3 flow:
 *   1. POST /file/get-signed-upload-urls  → { key, signedUrl }
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

  // 2. Request a presigned S3 upload URL from PostFast
  const signedRes = await fetch(`${BASE_URL}/file/get-signed-upload-urls`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ contentType, count: 1 }),
  })
  if (!signedRes.ok) {
    const text = await signedRes.text()
    throw new Error(`PostFast get-signed-upload-urls failed: ${signedRes.status} ${text}`)
  }
  const signedData = await signedRes.json()
  // API returns an array: [{ key, signedUrl }]
  const { key, signedUrl } = Array.isArray(signedData) ? signedData[0] : signedData
  if (!key || !signedUrl) {
    throw new Error(`PostFast signed URL response missing key/signedUrl: ${JSON.stringify(signedData)}`)
  }

  // 3. PUT the image bytes directly to S3 via the presigned URL
  const s3Res = await fetch(signedUrl, {
    method:  'PUT',
    headers: { 'Content-Type': contentType },
    body:    buffer,
  })
  if (!s3Res.ok) throw new Error(`S3 presigned upload failed: ${s3Res.status}`)

  const type = key.startsWith('video/') ? 'VIDEO' : 'IMAGE'
  console.log(`[postfast] Media uploaded: ${key}`)
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
