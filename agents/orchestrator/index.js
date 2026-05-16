import { buildMemoryContext, formatMemoryContext } from '../tools/memory.js'
import { planBlocks, campaignSummaryBlocks, approvalBlocks, imageApprovalBlocks, reelBriefBlocks } from '../tools/slack.js'
import supabase from '../tools/supabase.js'
import { runMarketingDirector } from '../directors/marketing-director/index.js'
import { registerReelThread } from '../tools/reel-state.js'

/**
 * Tier 1 — Orchestrator
 * Single entry point from Slack. Pulls context, routes to department directors,
 * receives compiled outputs, and surfaces them to Slack for approval.
 * Never calls specialist agents directly.
 */
export async function runOrchestrator({ brief, product, channelId, userId, slackClient }) {
  console.log(`[orchestrator] Starting campaign for ${product}: ${brief.substring(0, 80)}`)

  // 1. Pull full context
  const memory     = await buildMemoryContext(product)
  const memoryText = formatMemoryContext(memory)

  // 2. Create campaign record (name filled in after director returns)
  const { data: campaign, error: campErr } = await supabase
    .from('campaign_log')
    .insert({
      product,
      name:          `${product} campaign — planning`,
      brief,
      status:        'active',
      task_plan:     {},
      slack_channel: channelId,
    })
    .select()
    .single()

  if (campErr) throw new Error(`Campaign creation failed: ${campErr.message}`)

  // 3. Route to Marketing Director — runs all tasks internally, no Slack during execution
  console.log(`[orchestrator] Routing to Marketing Director`)

  const result = await runMarketingDirector({
    brief,
    product,
    memoryText,
    campaignId:   campaign.id,
    campaignName: campaign.name,
    channelId,
    slackClient,
  })

  // 4. Update campaign record with final name and plan
  await supabase
    .from('campaign_log')
    .update({
      name:      result.campaignName,
      task_plan: { tasks: result.tasks, summary: result.summary },
    })
    .eq('id', campaign.id)

  // 5. Post plan block to Slack
  await slackClient.chat.postMessage({
    channel: channelId,
    text:    `📋 Campaign plan: ${result.campaignName}`,
    blocks:  planBlocks({
      campaign_name:      result.campaignName,
      product,
      summary:            result.summary,
      estimated_timeline: result.estimatedTimeline,
      tasks:              result.tasks,
    }),
  })

  // 6. Post campaign summary (research/analytics briefs + assumptions)
  const flags = [
    ...(result.assumptions ?? []).map(a => `Assumption: ${a}`),
    ...(result.flags ?? []),
  ]

  await slackClient.chat.postMessage({
    channel: channelId,
    text:    `Campaign complete: ${result.campaignName}`,
    blocks:  campaignSummaryBlocks({
      campaignName:     result.campaignName,
      product,
      summary:          result.summary,
      researchSummary:  result.researchSummary,
      analyticsSummary: result.analyticsSummary,
      pendingCount:     result.pendingItems.length,
      flags,
    }),
  })

  // 7. Post one approval card per pending output
  for (const outputItem of result.pendingItems) {
    await postApprovalCard({ item: outputItem, campaignName: result.campaignName, channelId, slackClient })
  }

  console.log(`[orchestrator] Campaign ${campaign.id} complete — ${result.pendingItems.length} items pending approval`)
  return campaign
}

async function postApprovalCard({ item, campaignName, channelId, slackClient }) {
  // item may be a raw content_log row or an enriched designer result
  const contentItem = item.id ? item : item.contentItem ?? item
  const imageUrl    = item.imageUrl ?? contentItem.metadata?.image_url ?? null
  const refScreenshot = item.referenceScreenshot ?? contentItem.metadata?.reference_screenshot ?? null

  // Reel briefs get a production-required card — no approve/reject buttons
  if (contentItem.asset_status === 'production_required' || contentItem.content_type === 'reel') {
    const meta = contentItem.metadata ?? {}
    const blocks = reelBriefBlocks({
      contentId:    contentItem.id,
      campaignName,
      platform:     contentItem.platform,
      hook:         meta.hook     ?? '',
      scene:        meta.scene    ?? '',
      duration:     meta.duration ?? '',
      caption:      meta.caption  ?? contentItem.output ?? '',
    })
    const msg = await slackClient.chat.postMessage({
      channel: channelId,
      text:    `🎬 Reel brief ready — action required: ${contentItem.platform}`,
      blocks,
    })
    await supabase
      .from('content_log')
      .update({ slack_ts: msg.ts })
      .eq('id', contentItem.id)
    // Register thread so bot captures the Screen Studio recording attachment
    registerReelThread({ messageTs: msg.ts, contentId: contentItem.id, campaignId: contentItem.campaign_id, channelId })
    return
  }

  const sharedProps = {
    contentId:    contentItem.id,
    campaignName,
    agent:        contentItem.agent,
    taskType:     contentItem.task_type,
    platform:     contentItem.platform,
    output:       contentItem.output,
    metadata:     contentItem.metadata,
  }

  const blocks = imageUrl
    ? imageApprovalBlocks({ ...sharedProps, imageUrl, referenceScreenshot: refScreenshot })
    : approvalBlocks(sharedProps)

  const text = imageUrl
    ? `Post package ready: ${contentItem.platform}`
    : `Content ready for approval: ${contentItem.task_type}`

  const msg = await slackClient.chat.postMessage({ channel: channelId, text, blocks })

  await supabase
    .from('content_log')
    .update({ slack_ts: msg.ts })
    .eq('id', contentItem.id)
}
