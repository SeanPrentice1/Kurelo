// Slack Block Kit helpers

const AGENT_LABELS = {
  content:   'Content',
  ads:       'Ads',
  research:  'Research',
  analytics: 'Analytics',
}

const AGENT_EMOJIS = {
  content:   '✍️',
  ads:       '📣',
  research:  '🔍',
  analytics: '📊',
}

const PLATFORM_LABELS = {
  instagram:  'Instagram',
  tiktok:     'TikTok',
  linkedin:   'LinkedIn',
  reddit:     'Reddit',
  twitter:    'Twitter/X',
  meta_ads:   'Meta Ads',
  google_ads: 'Google Ads',
  stories:    'Stories',
}

const VISUAL_PLATFORMS = new Set(['instagram', 'tiktok', 'linkedin', 'twitter', 'meta_ads', 'google_ads', 'stories'])

function taskLabel(type) {
  return (type ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function platformLabel(p) {
  return PLATFORM_LABELS[p?.toLowerCase()] ?? p ?? '-'
}

// Split text that exceeds Slack's 3000-char block limit into multiple section blocks
function textBlocks(text, maxLen = 2500) {
  const blocks = []
  let remaining = text
  while (remaining.length > 0) {
    const chunk = remaining.substring(0, maxLen)
    remaining = remaining.substring(maxLen)
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } })
    if (remaining.length > 0) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_...continued_' } })
    }
  }
  return blocks
}

/** Blocks for the initial campaign plan post */
export function planBlocks({ campaign_name, product, summary, estimated_timeline, tasks }) {
  const productBadge = product === 'crevaxo' ? '🟠 Crevaxo' : '🟣 Rostura'

  const taskLines = tasks
    .map((t, i) => {
      const label = AGENT_LABELS[t.agent] ?? t.agent
      const plat  = t.platform ? ` - ${platformLabel(t.platform)}` : ''
      const imgNote = t.agent === 'content' && VISUAL_PLATFORMS.has(t.platform?.toLowerCase())
        ? ' _(+ image generation)_' : ''
      return `${i + 1}. *${label}*${plat}${imgNote} - ${t.description}`
    })
    .join('\n')

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 ${campaign_name}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Product:*\n${productBadge}` },
        { type: 'mrkdwn', text: `*Timeline:*\n${estimated_timeline ?? '-'}` },
      ],
    },
    ...textBlocks(`*Brief:*\n${summary}`),
    { type: 'divider' },
    ...textBlocks(`*Task plan:*\n${taskLines}`),
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '⚡ Marketing Director executing... outputs will appear below for approval.' }],
    },
  ]
}

/** Approval blocks for a text-only content item (copy + metadata, no image) */
export function approvalBlocks({ contentId, campaignName, agent, taskType, platform, output, metadata }) {
  const emoji = AGENT_EMOJIS[agent] ?? '📄'
  const label = AGENT_LABELS[agent] ?? agent

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${label}: ${taskLabel(taskType)}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Campaign:*\n${campaignName}` },
        { type: 'mrkdwn', text: `*Platform:*\n${platformLabel(platform)}` },
      ],
    },
  ]

  if (metadata?.hook) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Hook:*\n${metadata.hook}` },
    })
  }

  if (metadata?.headline) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Headline:*\n${metadata.headline}` },
    })
  }

  blocks.push(...textBlocks(`*Copy:*\n${output}`))

  const metaParts = []
  if (metadata?.hashtags?.length) metaParts.push(`*Hashtags:* ${metadata.hashtags.map(h => `#${h}`).join(' ')}`)
  if (metadata?.cta)              metaParts.push(`*CTA:* ${metadata.cta}`)
  if (metadata?.image_prompt)     metaParts.push(`*Image direction:* ${metadata.image_prompt}`)
  if (metadata?.variants?.length) {
    metaParts.push(`*Variants:*\n${metadata.variants.map((v, i) => `_Option ${i + 2}:_ ${v.headline} - ${v.primary_text}`).join('\n')}`)
  }

  if (metaParts.length) {
    blocks.push(...textBlocks(metaParts.join('\n')))
  }

  blocks.push({ type: 'divider' })
  blocks.push(actionButtons(contentId))

  return blocks
}

/** Approval blocks for a combined image + copy package */
export function imageApprovalBlocks({ contentId, campaignName, agent, taskType, platform, output, metadata, imageUrl, referenceScreenshot }) {
  const emoji = AGENT_EMOJIS[agent] ?? '📄'
  const label = AGENT_LABELS[agent] ?? agent

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${label}: ${taskLabel(taskType)}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Campaign:*\n${campaignName}` },
        { type: 'mrkdwn', text: `*Platform:*\n${platformLabel(platform)}` },
      ],
    },
    {
      type: 'image',
      image_url: imageUrl,
      alt_text:  `Generated visual for ${platformLabel(platform)} - ${campaignName}`,
    },
  ]

  if (metadata?.hook) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Hook:*\n${metadata.hook}` } })
  }

  blocks.push(...textBlocks(`*Copy:*\n${output}`))

  const metaParts = []
  if (metadata?.hashtags?.length) metaParts.push(`*Hashtags:* ${metadata.hashtags.map(h => `#${h}`).join(' ')}`)
  if (metadata?.cta)              metaParts.push(`*CTA:* ${metadata.cta}`)
  if (referenceScreenshot)        metaParts.push(`*Reference used:* \`${referenceScreenshot}\``)

  if (metaParts.length) {
    blocks.push(...textBlocks(metaParts.join('\n')))
  }

  blocks.push({ type: 'divider' })
  blocks.push(actionButtons(contentId))

  return blocks
}

/** Campaign summary posted by orchestrator after Marketing Director compiles outputs */
export function campaignSummaryBlocks({ campaignName, product, summary, researchSummary, analyticsSummary, pendingCount, flags = [] }) {
  const productBadge = product === 'crevaxo' ? '🟠 Crevaxo' : '🟣 Rostura'

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `✅ Campaign ready: ${campaignName}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Product:*\n${productBadge}` },
        { type: 'mrkdwn', text: `*Outputs:*\n${pendingCount} post${pendingCount === 1 ? '' : 's'} pending approval` },
      ],
    },
    ...textBlocks(`*Summary:*\n${summary}`),
  ]

  if (researchSummary) {
    blocks.push({ type: 'divider' })
    blocks.push(...textBlocks(`🔍 *Research brief:*\n${researchSummary}`))
  }

  if (analyticsSummary) {
    blocks.push(...textBlocks(`📊 *Analytics brief:*\n${analyticsSummary}`))
  }

  if (flags.length) {
    blocks.push({ type: 'divider' })
    blocks.push(...textBlocks(`⚠️ *Flags:*\n${flags.map(f => `- ${f}`).join('\n')}`))
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '👇 Approval cards below - one per output.' }],
  })

  return blocks
}

/** Replace an approval message with a resolved state */
export function resolvedBlocks({ decision, decidedBy, output, agent, taskType }) {
  const emoji = decision === 'approved' ? '✅' : '❌'
  const label = decision === 'approved' ? 'Approved' : 'Rejected'
  const agentEmoji = AGENT_EMOJIS[agent] ?? ''
  const preview = output.substring(0, 280) + (output.length > 280 ? '...' : '')

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${label}* by <@${decidedBy}> - ${agentEmoji} ${taskLabel(taskType)}\n${preview}`,
      },
    },
  ]
}

/**
 * Schedule suggestion card posted after content approval.
 * Each option button encodes contentId + ISO date as the action value.
 * @param {object} opts
 * @param {string}   opts.contentId
 * @param {string}   opts.platform
 * @param {string}   opts.product
 * @param {Date[]}   opts.options    - 3 suggested Date objects
 */
export function scheduleOptionsBlocks({ contentId, platform, product, options }) {
  const platLabel = PLATFORM_LABELS[platform?.toLowerCase()] ?? platform ?? 'post'
  const productBadge = product === 'crevaxo' ? '🟠 Crevaxo' : '🟣 Rostura'

  const formatOption = (date) => {
    const day  = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })
    return `${day} · ${time} UTC`
  }

  const makeButton = (date, label, style) => ({
    type:      'button',
    text:      { type: 'plain_text', text: label, emoji: true },
    ...(style ? { style } : {}),
    action_id: 'confirm_schedule',
    value:     `${contentId}|${date.toISOString()}`,
  })

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📅 *When should this ${platLabel} post go out?*\n${productBadge} — pick a slot or choose an alternative.`,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Suggested:* ${formatOption(options[0])}` },
    },
    {
      type: 'actions',
      elements: [
        makeButton(options[0], '✅ Confirm suggested', 'primary'),
        ...(options[1] ? [makeButton(options[1], `📅 ${formatOption(options[1])}`)] : []),
        ...(options[2] ? [makeButton(options[2], `📅 ${formatOption(options[2])}`)] : []),
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Choosing a slot commits the post to PostFast. You can still edit it there before it publishes._' }],
    },
  ]
}

/**
 * Replace the schedule options card once a slot is confirmed.
 */
export function scheduleConfirmedBlocks({ platform, scheduledAt, hasImage }) {
  const platLabel = PLATFORM_LABELS[platform?.toLowerCase()] ?? platform ?? 'post'
  const dateStr   = scheduledAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const timeStr   = scheduledAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })
  const imageNote = hasImage ? ' with image' : ''

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *${platLabel} post scheduled${imageNote}*\n📅 Going out on *${dateStr}* at *${timeStr} UTC*\n_You can view or edit this post in PostFast before it publishes._`,
      },
    },
  ]
}

function actionButtons(contentId) {
  return {
    type: 'actions',
    elements: [
      {
        type:      'button',
        text:      { type: 'plain_text', text: '✅ Approve', emoji: true },
        style:     'primary',
        action_id: 'approve_content',
        value:     contentId,
      },
      {
        type:      'button',
        text:      { type: 'plain_text', text: '❌ Reject', emoji: true },
        style:     'danger',
        action_id: 'reject_content',
        value:     contentId,
      },
    ],
  }
}
