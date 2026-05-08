import { generateImage, selectModel } from '../../tools/nanobanana.js'
import supabase from '../../tools/supabase.js'

const BRAND_COLORS = {
  crevaxo: { primary: '#F97316', secondary: '#0F1E35', label: 'orange (#F97316) and navy (#0F1E35)' },
  rostura: { primary: '#0D9B8A', secondary: '#ffffff', label: 'teal (#0D9B8A)' },
}

// Keyword map for selecting the most relevant Crevaxo reference screenshot folder
const SCREENSHOT_KEYWORDS = {
  'license-flow':       ['license', 'licensing', 'sign', 'signature', 'agreement', 'contract', 'legal', 'rights'],
  'asset-library':      ['asset', 'library', 'upload', 'file', 'portfolio', 'image', 'photo', 'store'],
  'project-dashboard':  ['project', 'dashboard', 'overview', 'manage', 'workflow', 'jobs', 'clients'],
  'client-signing':     ['client', 'sign', 'signing', 'onboard', 'send', 'review'],
  'settings':           ['settings', 'setup', 'configure', 'account', 'profile', 'billing'],
}

/**
 * Generates an image for a content item, optionally using a Crevaxo
 * reference screenshot from the reference-screenshots bucket.
 * Returns the content item enriched with image data, or null on failure.
 * Never posts to Slack — the Orchestrator handles all Slack output.
 */
export async function runDesignerAgent({ contentItem, campaignId, campaignName, channelId, slackClient, notifySlack = true }) {
  console.log(`[designer-agent] Generating image for content ${contentItem.id} on ${contentItem.platform}`)

  const model    = selectModel(contentItem.metadata)
  const platform = contentItem.platform

  // Fetch reference screenshot for Crevaxo posts
  const { buffer: refBuffer, name: refName } = await fetchReferenceScreenshot(contentItem)

  const prompt = buildImagePrompt(contentItem)

  let publicUrl = null

  try {
    const { imageBuffer } = await generateImage({
      prompt,
      model,
      platform,
      referenceImageBuffer: refBuffer ?? null,
    })

    const storagePath = buildStoragePath(campaignId, contentItem.id)
    const { error: uploadErr } = await supabase.storage
      .from('agent-assets')
      .upload(storagePath, imageBuffer, { contentType: 'image/png', upsert: true })

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

    const { data: { publicUrl: url } } = supabase.storage
      .from('agent-assets')
      .getPublicUrl(storagePath)

    publicUrl = url

    await supabase.from('asset_library').insert({
      product:    contentItem.product,
      asset_type: 'image',
      title:      `${platform} image - ${campaignName}`,
      content:    prompt,
      platform,
      metadata: {
        model,
        storage_path:        storagePath,
        campaign_id:         campaignId,
        content_log_id:      contentItem.id,
        reference_screenshot: refName ?? null,
        prompt,
      },
    })

    const updatedMetadata = {
      ...contentItem.metadata,
      image_url:            publicUrl,
      image_model:          model,
      image_prompt_used:    prompt,
      reference_screenshot: refName ?? null,
    }

    await supabase
      .from('content_log')
      .update({ metadata: updatedMetadata })
      .eq('id', contentItem.id)

    contentItem = { ...contentItem, metadata: updatedMetadata }
    console.log(`[designer-agent] Image uploaded: ${storagePath}`)
  } catch (err) {
    console.error(`[designer-agent] Image generation failed: ${err.message}`)
  }

  // Return enriched item — Orchestrator decides what to post to Slack
  return {
    ...contentItem,
    imageUrl:            publicUrl,
    referenceScreenshot: refName ?? null,
  }
}

// ── Reference screenshot lookup ──────────────────────────────────────────────

async function fetchReferenceScreenshot(item) {
  if (item.product !== 'crevaxo') return { buffer: null, name: null }

  const folder = matchFolder(item)
  if (!folder) return { buffer: null, name: null }

  try {
    const bucketPath = `crevaxo/${folder}`
    const { data: files, error } = await supabase.storage
      .from('reference-screenshots')
      .list(bucketPath, { limit: 10 })

    if (error || !files?.length) return { buffer: null, name: null }

    // Pick a random file from the folder to vary reference inputs
    const file = files[Math.floor(Math.random() * files.length)]
    const filePath = `${bucketPath}/${file.name}`

    const { data: blob, error: downloadErr } = await supabase.storage
      .from('reference-screenshots')
      .download(filePath)

    if (downloadErr || !blob) return { buffer: null, name: null }

    const arrayBuffer = await blob.arrayBuffer()
    return { buffer: Buffer.from(arrayBuffer), name: `${folder}/${file.name}` }
  } catch (err) {
    console.warn(`[designer-agent] Reference screenshot fetch failed: ${err.message}`)
    return { buffer: null, name: null }
  }
}

function matchFolder(item) {
  const text = [
    item.task_type ?? '',
    item.output ?? '',
    item.metadata?.image_prompt ?? '',
    item.metadata?.hook ?? '',
  ].join(' ').toLowerCase()

  let bestFolder = null
  let bestScore  = 0

  for (const [folder, keywords] of Object.entries(SCREENSHOT_KEYWORDS)) {
    const score = keywords.filter(kw => text.includes(kw)).length
    if (score > bestScore) { bestScore = score; bestFolder = folder }
  }

  return bestScore > 0 ? bestFolder : 'project-dashboard'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildImagePrompt(item) {
  const { product, platform, output: copy, metadata = {} } = item
  const colors = BRAND_COLORS[product] ?? BRAND_COLORS.crevaxo

  const parts = [
    `Create a ${platform} social media image.`,
    `Brand colors: ${metadata.color_override ?? colors.label}.`,
    `Style: ${metadata.image_style ?? 'clean, modern, premium brand photography'}.`,
    `Mood: ${metadata.mood ?? 'confident, authentic, professional'}.`,
  ]

  if (metadata.image_prompt) {
    parts.push(`Visual direction: ${metadata.image_prompt}`)
  } else if (copy) {
    parts.push(`The post is about: ${copy.substring(0, 180)}`)
  }

  if (metadata.text_in_image) {
    parts.push(`Include this text in the image: "${metadata.text_in_image}"`)
  }

  parts.push('No stock photo aesthetic. Authentic, high quality, platform-native feel.')

  return parts.join(' ')
}

function buildStoragePath(campaignId, contentId) {
  const now = new Date()
  const y   = now.getUTCFullYear()
  const m   = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d   = String(now.getUTCDate()).padStart(2, '0')
  return `${y}/${m}/${d}/${campaignId}/${contentId}.png`
}
