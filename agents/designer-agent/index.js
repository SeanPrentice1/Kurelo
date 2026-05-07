import { generateImage, selectModel, MODELS } from '../tools/nanobanana.js'
import { approvalBlocks } from '../tools/slack.js'
import { imageApprovalBlocks } from '../tools/slack.js'
import supabase from '../tools/supabase.js'

const BRAND_COLORS = {
  crevaxo: { primary: '#F97316', secondary: '#0F1E35', label: 'orange (#F97316) and navy (#0F1E35)' },
  rostura: { primary: '#0D9B8A', secondary: '#ffffff', label: 'teal (#0D9B8A)' },
}

/**
 * Runs after the content agent for visual platforms.
 * Generates an image, stores it, and sends the combined copy+image
 * to Slack as a single approval card.
 */
export async function runDesignerAgent({ contentItem, campaignId, campaignName, channelId, slackClient }) {
  console.log(`[designer-agent] Generating image for content ${contentItem.id} on ${contentItem.platform}`)

  const model    = selectModel(contentItem.metadata)
  const prompt   = buildImagePrompt(contentItem)
  const platform = contentItem.platform

  let publicUrl = null

  try {
    const { imageBuffer } = await generateImage({ prompt, model, platform })

    // Upload to Supabase Storage
    const storagePath = buildStoragePath(campaignId, contentItem.id)
    const { error: uploadErr } = await supabase.storage
      .from('agent-assets')
      .upload(storagePath, imageBuffer, { contentType: 'image/png', upsert: true })

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

    const { data: { publicUrl: url } } = supabase.storage
      .from('agent-assets')
      .getPublicUrl(storagePath)

    publicUrl = url

    // Log in asset_library
    await supabase.from('asset_library').insert({
      product:    contentItem.product,
      asset_type: 'image',
      title:      `${platform} image — ${campaignName}`,
      content:    prompt,
      platform,
      metadata: {
        model,
        storage_path:   storagePath,
        campaign_id:    campaignId,
        content_log_id: contentItem.id,
        prompt,
      },
    })

    // Attach image URL to content_log so dashboard can reference it
    await supabase
      .from('content_log')
      .update({
        metadata: {
          ...contentItem.metadata,
          image_url:   publicUrl,
          image_model: model,
          image_prompt_used: prompt,
        },
      })
      .eq('id', contentItem.id)

    console.log(`[designer-agent] Image uploaded: ${storagePath}`)
  } catch (err) {
    console.error(`[designer-agent] Image generation failed (will post copy-only): ${err.message}`)
  }

  // Post to Slack — image+copy if we have an image, copy-only fallback if not
  const blocks = publicUrl
    ? imageApprovalBlocks({
        contentId:    contentItem.id,
        campaignName,
        agent:        'content',
        taskType:     contentItem.task_type,
        platform,
        output:       contentItem.output,
        metadata:     contentItem.metadata,
        imageUrl:     publicUrl,
      })
    : approvalBlocks({
        contentId:    contentItem.id,
        campaignName,
        agent:        'content',
        taskType:     contentItem.task_type,
        platform,
        output:       contentItem.output,
        metadata:     contentItem.metadata,
      })

  const label = publicUrl
    ? `Post package ready for approval: ${platform}`
    : `Content ready for approval (image generation failed): ${platform}`

  const msg = await slackClient.chat.postMessage({
    channel: channelId,
    text:    label,
    blocks,
  })

  await supabase
    .from('content_log')
    .update({ slack_ts: msg.ts })
    .eq('id', contentItem.id)

  console.log(`[designer-agent] Sent to Slack: ${contentItem.id}`)
  return { contentItem, imageUrl: publicUrl }
}

// ── Helpers ──────────────────────────────────────────────────────

function buildImagePrompt(item) {
  const { product, platform, output: copy, metadata = {} } = item
  const colors = BRAND_COLORS[product] ?? BRAND_COLORS.crevaxo

  const parts = [
    `Create a ${platform} social media image.`,
    `Brand colors: ${metadata.color_override ?? colors.label}.`,
    `Style: ${metadata.image_style ?? 'clean, modern, premium brand photography'}.`,
    `Mood: ${metadata.mood ?? 'confident, authentic, professional'}.`,
  ]

  // Use the content agent's image_prompt if present, otherwise derive from copy
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
