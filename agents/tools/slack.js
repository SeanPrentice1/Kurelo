// Slack Block Kit helpers

const AGENT_LABELS = {
  content:   'Content Agent',
  ads:       'Ads Agent',
  research:  'Research Agent',
  analytics: 'Analytics Agent',
}

const AGENT_EMOJIS = {
  content:   '✍️',
  ads:       '📣',
  research:  '🔍',
  analytics: '📊',
}

function taskLabel(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Blocks for the initial campaign plan post */
export function planBlocks({ campaign_name, product, summary, estimated_timeline, tasks }) {
  const taskLines = tasks
    .map((t, i) => `${i + 1}. *${(AGENT_LABELS[t.agent] ?? t.agent).toUpperCase()}* — ${t.description}`)
    .join('\n')

  const productBadge = product === 'crevaxo' ? '🟠 Crevaxo' : '🟣 Rostura'

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 New Campaign: ${campaign_name}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Product:*\n${productBadge}` },
        { type: 'mrkdwn', text: `*Timeline:*\n${estimated_timeline ?? '—'}` },
        { type: 'mrkdwn', text: `*Tasks:*\n${tasks.length} agent task${tasks.length === 1 ? '' : 's'}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Summary:*\n${summary}` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Task Breakdown:*\n${taskLines}` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '⚡ Dispatching agents… outputs will appear below for approval.' }],
    },
  ]
}

/** Blocks for an individual content approval request */
export function approvalBlocks({ contentId, campaignName, agent, taskType, platform, output, metadata }) {
  const emoji = AGENT_EMOJIS[agent] ?? '📄'
  const label = AGENT_LABELS[agent] ?? agent

  // Build metadata summary lines
  const metaEntries = []
  if (metadata?.hashtags?.length) metaEntries.push(`*Hashtags:* ${metadata.hashtags.map(h => `#${h}`).join(' ')}`)
  if (metadata?.hook)             metaEntries.push(`*Hook:* ${metadata.hook}`)
  if (metadata?.cta)              metaEntries.push(`*CTA:* ${metadata.cta}`)
  if (metadata?.headline)         metaEntries.push(`*Headline:* ${metadata.headline}`)
  if (metadata?.image_prompt)     metaEntries.push(`*Image prompt:* ${metadata.image_prompt}`)

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${label}: ${taskLabel(taskType)}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Campaign:*\n${campaignName}` },
        { type: 'mrkdwn', text: `*Platform:*\n${platform ?? '—'}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `\`\`\`${output}\`\`\`` },
    },
  ]

  if (metaEntries.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: metaEntries.join('\n') },
    })
  }

  blocks.push({ type: 'divider' })
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Approve', emoji: true },
        style: 'primary',
        action_id: 'approve_content',
        value: contentId,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '❌ Reject', emoji: true },
        style: 'danger',
        action_id: 'reject_content',
        value: contentId,
      },
    ],
  })

  return blocks
}

/** Replace an approval message with a resolved state */
export function resolvedBlocks({ decision, decidedBy, output, agent, taskType }) {
  const emoji = decision === 'approved' ? '✅' : '❌'
  const label = decision === 'approved' ? 'Approved' : 'Rejected'
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${label}* by <@${decidedBy}> — ${AGENT_EMOJIS[agent] ?? ''} ${taskLabel(taskType)}\n\`\`\`${output.substring(0, 300)}${output.length > 300 ? '…' : ''}\`\`\``,
      },
    },
  ]
}
