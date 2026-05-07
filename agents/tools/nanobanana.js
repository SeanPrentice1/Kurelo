const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const MODELS = {
  FAST: 'gemini-2.0-flash-exp',
  PRO:  'gemini-2.0-flash-exp', // same model; PRO path adds text-rendering hints to prompt
}

// Aspect ratios embedded in the prompt — Gemini Flash image gen does not accept a ratio param
export const ASPECT_RATIOS = {
  instagram:  '1:1 (square)',
  tiktok:     '9:16 (vertical)',
  stories:    '9:16 (vertical)',
  linkedin:   '16:9 (landscape)',
  twitter:    '16:9 (landscape)',
  meta_ads:   '1:1 (square)',
  google_ads: '16:9 (landscape)',
}

function apiKey() {
  const key = process.env.NANO_BANANA_API_KEY
  if (!key) throw new Error('NANO_BANANA_API_KEY is not set')
  return key
}

/**
 * Generate an image via the Google AI Gemini image generation API.
 * Returns { imageBuffer } — a Buffer ready for Supabase upload.
 */
export async function generateImage({ prompt, model = MODELS.FAST, platform = null }) {
  const ratio = ASPECT_RATIOS[platform?.toLowerCase()] ?? '1:1 (square)'
  const fullPrompt = `${prompt} Compose the image in a ${ratio} aspect ratio.`

  const res = await fetch(
    `${BASE_URL}/models/${model}:generateContent?key=${apiKey()}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
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
  if (!part) throw new Error(`Gemini returned no image data: ${JSON.stringify(data).substring(0, 300)}`)

  const b64 = part.inlineData.data.replace(/^data:image\/\w+;base64,/, '')
  return { imageBuffer: Buffer.from(b64, 'base64') }
}

/**
 * Choose model based on whether the brief requires precise text rendering in the image.
 * Both use the same underlying model; PRO sets text_in_image in metadata which
 * buildImagePrompt() in the designer agent picks up to add text-rendering direction.
 */
export function selectModel(metadata = {}) {
  return metadata.text_in_image ? MODELS.PRO : MODELS.FAST
}
