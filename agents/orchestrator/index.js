import { anthropic, MODELS } from '../tools/anthropic.js'
import { buildMemoryContext, formatMemoryContext } from '../tools/memory.js'
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../prompts/orchestrator.js'
import { planBlocks, approvalBlocks } from '../tools/slack.js'
import supabase from '../tools/supabase.js'
import { runContentAgent } from '../content-agent/index.js'
import { runAdsAgent } from '../ads-agent/index.js'
import { runResearchAgent } from '../research-agent/index.js'
import { runAnalyticsAgent } from '../analytics-agent/index.js'
import { runDesignerAgent } from '../designer-agent/index.js'

const AGENT_RUNNERS = {
  content:   runContentAgent,
  ads:       runAdsAgent,
  research:  runResearchAgent,
  analytics: runAnalyticsAgent,
}

// Platforms that require a generated image — Reddit is text-only and skips the designer
const VISUAL_PLATFORMS = new Set(['instagram', 'tiktok', 'linkedin', 'twitter', 'meta_ads', 'google_ads', 'stories'])

/**
 * Main orchestrator entry point.
 * Called by the Slack bot when a /kurelo command is received.
 */
export async function runOrchestrator({ brief, product, channelId, userId, slackClient }) {
  console.log(`[orchestrator] Starting campaign for ${product}: ${brief.substring(0, 80)}`)

  // 1. Fetch memory context
  const memory = await buildMemoryContext(product)
  const memoryText = formatMemoryContext(memory)

  // 2. Generate structured plan via Opus
  const plan = await generatePlan({ brief, product, memoryText })
  console.log(`[orchestrator] Plan generated: ${plan.campaign_name} (${plan.tasks.length} tasks)`)

  // 3. Persist campaign
  const { data: campaign, error: campErr } = await supabase
    .from('campaign_log')
    .insert({
      product,
      name:         plan.campaign_name,
      brief,
      status:       'active',
      task_plan:    plan,
      slack_channel: channelId,
    })
    .select()
    .single()

  if (campErr) throw new Error(`Campaign creation failed: ${campErr.message}`)

  // 4. Post plan to Slack
  const planMsg = await slackClient.chat.postMessage({
    channel: channelId,
    text:    `📋 Campaign plan ready: ${plan.campaign_name}`,
    blocks:  planBlocks(plan),
  })

  await supabase
    .from('campaign_log')
    .update({ slack_plan_ts: planMsg.ts })
    .eq('id', campaign.id)

  // 5. Dispatch tasks, respecting depends_on dependencies
  await dispatchTasks({
    tasks:        plan.tasks,
    product,
    campaignId:   campaign.id,
    campaignName: plan.campaign_name,
    channelId,
    slackClient,
  })

  return campaign
}

async function generatePlan({ brief, product, memoryText }) {
  const response = await anthropic.messages.create({
    model:      MODELS.ORCHESTRATOR,
    max_tokens: 2048,
    system: [
      {
        type:          'text',
        text:          ORCHESTRATOR_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role:    'user',
        content: `MEMORY CONTEXT:\n${memoryText}\n\n---\n\nBRIEF:\n${brief}\n\nProduct: ${product}`,
      },
    ],
  })

  const raw = response.content[0].text.trim()

  try {
    return JSON.parse(raw)
  } catch {
    // Tolerate models that wrap JSON in markdown fences
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)
    if (match) return JSON.parse(match[1] ?? match[0])
    throw new Error(`Orchestrator returned unparseable response: ${raw.substring(0, 200)}`)
  }
}

async function dispatchTasks({ tasks, product, campaignId, campaignName, channelId, slackClient }) {
  // Exclude scheduler tasks — they're triggered by approvals, not by the plan
  const workTasks = tasks
    .filter(t => t.agent !== 'scheduler')
    .map(t => ({ ...t, product: t.product ?? product }))
  const outputs   = new Map() // taskId → agent output (for dependency context)
  const remaining = [...workTasks]

  while (remaining.length > 0) {
    // Find all tasks whose dependencies are satisfied
    const ready = remaining.filter(t =>
      (t.depends_on ?? []).every(dep => outputs.has(dep))
    )

    if (ready.length === 0) {
      console.warn('[orchestrator] Dependency deadlock — running remaining tasks anyway')
      break
    }

    // Run ready tasks in parallel
    const settled = await Promise.allSettled(
      ready.map(task =>
        runTask({ task, campaignId, campaignName, channelId, slackClient, outputs })
      )
    )

    for (let i = 0; i < ready.length; i++) {
      const result = settled[i]
      if (result.status === 'fulfilled') {
        outputs.set(ready[i].id, result.value)
      } else {
        console.error(`[orchestrator] Task ${ready[i].id} failed:`, result.reason)
      }
      remaining.splice(remaining.indexOf(ready[i]), 1)
    }
  }
}

async function runTask({ task, campaignId, campaignName, channelId, slackClient, outputs }) {
  const runner = AGENT_RUNNERS[task.agent]
  if (!runner) {
    console.warn(`[orchestrator] No runner for agent: ${task.agent}`)
    return null
  }

  // Pass outputs from dependencies as context
  const dependencyContext = (task.depends_on ?? [])
    .map(dep => outputs.get(dep))
    .filter(Boolean)

  const needsDesigner = task.agent === 'content' && VISUAL_PLATFORMS.has(task.platform?.toLowerCase())

  const result = await runner({
    task,
    campaignId,
    campaignName,
    channelId,
    slackClient,
    dependencyContext,
    ...(needsDesigner ? { skipSlack: true } : {}),
  })

  if (needsDesigner && result) {
    await runDesignerAgent({ contentItem: result, campaignId, campaignName, channelId, slackClient })
      .catch(async err => {
        console.error('[orchestrator] Designer failed, falling back to copy-only:', err.message)
        const msg = await slackClient.chat.postMessage({
          channel: channelId,
          text:    `Content ready for approval: ${task.type}`,
          blocks:  approvalBlocks({
            contentId:    result.id,
            campaignName,
            agent:        'content',
            taskType:     task.type,
            platform:     task.platform,
            output:       result.output,
            metadata:     result.metadata,
          }),
        })
        await supabase
          .from('content_log')
          .update({ slack_ts: msg.ts })
          .eq('id', result.id)
      })
  }

  return result
}
