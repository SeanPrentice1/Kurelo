const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const MODELS = {
  FAST: 'gemini-3.1-flash-image-preview',
  PRO:  'gemini-3-pro-image-preview',
}

const ASPECT_HINT = {
  instagram:  '1:1 square',
  tiktok:     '9:16 vertical',
  stories:    '9:16 vertical',
  linkedin:   '16:9 landscape',
  twitter:    '16:9 landscape',
  meta_ads:   '1:1 square',
  google_ads: '16:9 landscape',
}

const MAX_ATTEMPTS = 2        // 1 auto-retry on transient failure
const RETRY_DELAY_MS = 3_000  // 3 s before retry

function apiKey() {
  const key = process.env.NANO_BANANA_API_KEY
  if (!key) throw new Error('NANO_BANANA_API_KEY is not set')
  return key
}

/**
 * Generate an image via the Gemini image generation API.
 * Automatically retries once on failure (network errors, transient 5xx).
 * Throws on final failure — callers must handle.
 *
 * @param {object}  opts
 * @param {string}  opts.prompt
 * @param {string}  [opts.model]
 * @param {string}  [opts.platform]
 * @param {Buffer}  [opts.referenceImageBuffer]
 * @returns {{ imageBuffer: Buffer }}
 */
export async function generateImage({ prompt, model = MODELS.FAST, platform = null, referenceImageBuffer = null }) {
  const ratio      = ASPECT_HINT[platform?.toLowerCase()] ?? '1:1 square'
  const fullPrompt = `${prompt} Compose as a ${ratio} image.`

  const parts = [{ text: fullPrompt }]

  if (referenceImageBuffer) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: referenceImageBuffer.toString('base64'),
      },
    })
  }

  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `${BASE_URL}/models/${model}:generateContent?key=${apiKey()}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ['IMAGE'] },
          }),
        }
      )

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Gemini image error ${res.status}: ${body}`)
      }

      const data = await res.json()
      const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
      if (!part) throw new Error(`No image in response: ${JSON.stringify(data).substring(0, 300)}`)

      const b64 = part.inlineData.data.replace(/^data:image\/\w+;base64,/, '')
      return { imageBuffer: Buffer.from(b64, 'base64') }
    } catch (err) {
      lastError = err
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[nanobanana] Attempt ${attempt} failed: ${err.message} — retrying in ${RETRY_DELAY_MS / 1000}s`)
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
      }
    }
  }

  throw new Error(`Image generation failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`)
}

export function selectModel(metadata = {}) {
  return metadata.text_in_image ? MODELS.PRO : MODELS.FAST
}
