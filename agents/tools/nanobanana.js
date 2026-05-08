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

function apiKey() {
  const key = process.env.NANO_BANANA_API_KEY
  if (!key) throw new Error('NANO_BANANA_API_KEY is not set')
  return key
}

/**
 * Generate an image via the Gemini image generation API.
 * Optionally pass referenceImageBuffer (Buffer) to include a reference screenshot.
 * Returns { imageBuffer } — a Buffer ready for Supabase upload.
 */
export async function generateImage({ prompt, model = MODELS.FAST, platform = null, referenceImageBuffer = null }) {
  const ratio = ASPECT_HINT[platform?.toLowerCase()] ?? '1:1 square'
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
}

export function selectModel(metadata = {}) {
  return metadata.text_in_image ? MODELS.PRO : MODELS.FAST
}
