const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const MODELS = {
  FAST: 'gemini-2.0-flash-preview-image-generation', // Gemini Flash — default
  PRO:  'imagen-3.0-generate-002',                   // Imagen 3 — precise text rendering
}

// Map platform → aspect ratio
// Gemini Flash ignores the ratio param (we embed it in the prompt)
// Imagen 3 supports: "1:1" | "9:16" | "16:9" | "3:4" | "4:3"
export const ASPECT_RATIOS = {
  instagram:  { ratio: '1:1',  imagenRatio: '1:1'  },
  tiktok:     { ratio: '9:16', imagenRatio: '9:16' },
  stories:    { ratio: '9:16', imagenRatio: '9:16' },
  linkedin:   { ratio: '16:9', imagenRatio: '16:9' },
  twitter:    { ratio: '16:9', imagenRatio: '16:9' },
  meta_ads:   { ratio: '1:1',  imagenRatio: '1:1'  },
  google_ads: { ratio: '16:9', imagenRatio: '16:9' },
}

function apiKey() {
  const key = process.env.NANO_BANANA_API_KEY
  if (!key) throw new Error('NANO_BANANA_API_KEY is not set')
  return key
}

/**
 * Generate an image via the Google AI (Gemini) image generation API.
 * Returns { imageBuffer } — a Buffer ready for Supabase upload.
 *
 * FAST model (Gemini Flash): uses generateContent, aspect ratio hinted via prompt.
 * PRO model (Imagen 3): uses predict, aspect ratio passed as API parameter.
 */
export async function generateImage({ prompt, model = MODELS.FAST, platform = null }) {
  const dims = ASPECT_RATIOS[platform?.toLowerCase()] ?? { ratio: '1:1', imagenRatio: '1:1' }

  if (model === MODELS.PRO) {
    return generateWithImagen3({ prompt, imagenRatio: dims.imagenRatio })
  }
  return generateWithGeminiFlash({ prompt, ratio: dims.ratio })
}

async function generateWithGeminiFlash({ prompt, ratio }) {
  const fullPrompt = `${prompt} Aspect ratio: ${ratio}.`

  const res = await fetch(
    `${BASE_URL}/models/${MODELS.FAST}:generateContent?key=${apiKey()}`,
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
    throw new Error(`Gemini Flash image error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
  if (!part) throw new Error('Gemini Flash returned no image data')

  const b64 = part.inlineData.data.replace(/^data:image\/\w+;base64,/, '')
  return { imageBuffer: Buffer.from(b64, 'base64') }
}

async function generateWithImagen3({ prompt, imagenRatio }) {
  const res = await fetch(
    `${BASE_URL}/models/${MODELS.PRO}:predict?key=${apiKey()}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances:  [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: imagenRatio },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Imagen 3 error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const b64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!b64) throw new Error('Imagen 3 returned no image data')

  return { imageBuffer: Buffer.from(b64, 'base64') }
}

/**
 * Choose model based on whether the brief requires precise text rendering in the image.
 */
export function selectModel(metadata = {}) {
  return metadata.text_in_image ? MODELS.PRO : MODELS.FAST
}
