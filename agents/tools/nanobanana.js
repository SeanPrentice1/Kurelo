const BASE_URL = 'https://api.nanobananaapi.ai/v1'

export const MODELS = {
  FAST: 'gemini-3.1-flash-image-preview', // Nano Banana 2 — default
  PRO:  'gemini-3-pro-image-preview',      // Nano Banana Pro — precise text rendering
}

// Map platform → aspect ratio string and pixel dimensions
export const ASPECT_RATIOS = {
  instagram:  { ratio: '1:1',    width: 1024, height: 1024 },
  tiktok:     { ratio: '9:16',   width: 1080, height: 1920 },
  stories:    { ratio: '9:16',   width: 1080, height: 1920 },
  linkedin:   { ratio: '1.91:1', width: 1200, height: 628  },
  twitter:    { ratio: '16:9',   width: 1200, height: 675  },
  meta_ads:   { ratio: '1:1',    width: 1024, height: 1024 },
  google_ads: { ratio: '1.91:1', width: 1200, height: 628  },
}

function headers() {
  const key = process.env.NANO_BANANA_API_KEY
  if (!key) throw new Error('NANO_BANANA_API_KEY is not set')
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
  }
}

/**
 * Generate an image via the Nano Banana API.
 * Returns { imageUrl, imageBuffer } — imageBuffer is a Buffer ready for Supabase upload.
 */
export async function generateImage({ prompt, model = MODELS.FAST, platform = null }) {
  const dims = ASPECT_RATIOS[platform?.toLowerCase()] ?? { ratio: '1:1', width: 1024, height: 1024 }

  const res = await fetch(`${BASE_URL}/generate`, {
    method:  'POST',
    headers: headers(),
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio:  dims.ratio,
      width:         dims.width,
      height:        dims.height,
      output_format: 'url',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Nano Banana API error ${res.status}: ${body}`)
  }

  const data = await res.json()

  let imageBuffer
  let imageUrl

  if (data.url) {
    imageUrl = data.url
    const imgRes = await fetch(data.url)
    imageBuffer = Buffer.from(await imgRes.arrayBuffer())
  } else if (data.image) {
    const b64 = data.image.replace(/^data:image\/\w+;base64,/, '')
    imageBuffer = Buffer.from(b64, 'base64')
    imageUrl = null
  } else {
    throw new Error('Nano Banana API returned no image data')
  }

  return { imageUrl, imageBuffer }
}

/**
 * Choose model based on whether the brief requires precise text rendering in the image.
 */
export function selectModel(metadata = {}) {
  return metadata.text_in_image ? MODELS.PRO : MODELS.FAST
}
