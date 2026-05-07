const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const MODELS = {
  FAST: 'imagen-3.0-fast-generate-001', // Imagen 3 Fast — default
  PRO:  'imagen-3.0-generate-002',      // Imagen 3 — precise text rendering
}

// Imagen 3 supported aspect ratios: "1:1" | "9:16" | "16:9" | "3:4" | "4:3"
export const ASPECT_RATIOS = {
  instagram:  '1:1',
  tiktok:     '9:16',
  stories:    '9:16',
  linkedin:   '16:9',
  twitter:    '16:9',
  meta_ads:   '1:1',
  google_ads: '16:9',
}

function apiKey() {
  const key = process.env.NANO_BANANA_API_KEY
  if (!key) throw new Error('NANO_BANANA_API_KEY is not set')
  return key
}

/**
 * Generate an image via the Google AI Imagen 3 API.
 * Returns { imageBuffer } — a Buffer ready for Supabase upload.
 */
export async function generateImage({ prompt, model = MODELS.FAST, platform = null }) {
  const aspectRatio = ASPECT_RATIOS[platform?.toLowerCase()] ?? '1:1'

  const res = await fetch(
    `${BASE_URL}/models/${model}:predict?key=${apiKey()}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances:  [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Imagen API error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const b64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!b64) throw new Error('Imagen API returned no image data')

  return { imageBuffer: Buffer.from(b64, 'base64') }
}

/**
 * Choose model based on whether the brief requires precise text rendering in the image.
 */
export function selectModel(metadata = {}) {
  return metadata.text_in_image ? MODELS.PRO : MODELS.FAST
}
