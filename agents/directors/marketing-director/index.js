import { anthropic, MODELS } from '../../tools/anthropic.js'
import { MARKETING_DIRECTOR_SYSTEM_PROMPT } from '../../prompts/marketing-director.js'
import { runContentAgent }   from '../../marketing/content-agent/index.js'
import { runAdsAgent }       from '../../marketing/ads-agent/index.js'
import { runResearchAgent }  from '../../marketing/research-agent/index.js'
import { runAnalyticsAgent } from '../../marketing/analytics-agent/index.js'
import { runDesignerAgent }  from '../../marketing/designer-agent/index.js'

const AGENT_RUNNERS = {
  content:   runContentAgent,
  ads:       runAdsAgent,
  research:  runResearchAgent,
  analytics: runAnalyticsAgent,
}

const VISUAL_PLATFORMS = new Set(['instagram', 'tiktok', 'linkedin', 'twitter', 'meta_ads', 'google_ads', 'stories'])

/**
 * The Marketing Director receives a brief from the Orchestrator,
 * plans and executes all marketing tasks internally, and returns
 * compiled outputs to the Orchestrator for Slack surfacing.
 *
 * Nothing posts to Slack from here — all Slack output is handled by the Orchestrator.
 */
export async function runMarketingDirector({ brief, memoryText, campaignId, campaignName: incomingName, product, channelId, slackClient }) {
  console.log(`[marketing-director] Received brief for ${product}: ${brief.substring(0, 80)}`)

  // 1. Generate task plan
  const plan = await generatePlan({ brief, product, memoryText })
  const campaignName = plan.campaign_name ?? incomingName
  console.log(`[marketing-director] Plan: ${campaignName} (${plan.tasks.length} tasks)`)

  // 2. Execute tasks in dependency order — all internal (no Slack posting)
  const { pendingItems, researchSummary, analyticsSummary, flags } = await executeTasks({
    tasks: plan.tasks,
    product,
    campaignId,
    campaignName,
    channelId,
    slackClient,
  })

  return {
    campaignName,
    summary:          plan.summary,
    assumptions:      plan.assumptions ?? [],
    estimatedTimeline: plan.estimated_timeline,
    tasks:            plan.tasks,
    pendingItems,
    researchSummary,
    analyticsSummary,
    flags,
  }
}

async function generatePlan({ brief, product, memoryText }) {
  const response = await anthropic.messages.create({
    model:      MODELS.DIRECTOR,
    max_tokens: 2048,
    system: [
      {
        type:          'text',
        text:          MARKETING_DIRECTOR_SYSTEM_PROMPT,
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
  try { return JSON.parse(raw) } catch { /* fall through to extraction */ }

  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)
  if (match) {
    try { return JSON.parse(match[1] ?? match[0]) } catch { /* fall through */ }
  }

  throw new Error(`Marketing Director returned unparseable plan: ${raw.substring(0, 400)}`)
}

async function executeTasks({ tasks, product, campaignId, campaignName, channelId, slackClient }) {
  const workTasks = tasks
    .filter(t => t.agent !== 'scheduler' && t.agent !== 'designer')
    .map(t => ({ ...t, product: t.product ?? product }))

  const outputs         = new Map()
  const pending         = []
  const flags           = []
  let   researchSummary = null
  let   analyticsSummary = null
  const remaining       = [...workTasks]

  while (remaining.length > 0) {
    const ready = remaining.filter(t =>
      (t.depends_on ?? []).every(dep => outputs.has(dep))
    )

    if (ready.length === 0) {
      console.warn('[marketing-director] Dependency deadlock — running remaining tasks')
      break
    }

    const settled = await Promise.allSettled(
      ready.map(task => runTask({ task, campaignId, campaignName, channelId, slackClient, outputs }))
    )

    for (let i = 0; i < ready.length; i++) {
      const result = settled[i]
      if (result.status === 'fulfilled' && result.value) {
        const { item, designerResult } = result.value
        outputs.set(ready[i].id, item)

        if (item.agent === 'research')  researchSummary  = extractBullets(item.output)
        if (item.agent === 'analytics') analyticsSummary = extractBullets(item.output)

        // Only content/ads items surface for Slack approval
        if (item.agent === 'content' || item.agent === 'ads') {
          pending.push(designerResult ?? item)
        }
      } else if (result.status === 'rejected') {
        console.error(`[marketing-director] Task ${ready[i].id} failed:`, result.reason)
        flags.push(`Task ${ready[i].id} (${ready[i].agent}) failed: ${result.reason?.message ?? 'unknown error'}`)
      }
      remaining.splice(remaining.indexOf(ready[i]), 1)
    }
  }

  return { pendingItems: pending, researchSummary, analyticsSummary, flags }
}

async function runTask({ task, campaignId, campaignName, channelId, slackClient, outputs }) {
  const runner = AGENT_RUNNERS[task.agent]
  if (!runner) {
    console.warn(`[marketing-director] No runner for agent: ${task.agent}`)
    return null
  }

  const dependencyContext = (task.depends_on ?? [])
    .map(dep => outputs.get(dep))
    .filter(Boolean)

  // All agents run silently — no Slack posting (notifySlack: false)
  const item = await runner({
    task,
    campaignId,
    campaignName,
    channelId,
    slackClient,
    dependencyContext,
    notifySlack: false,
  })

  // For visual content platforms, run the designer agent after content
  let designerResult = null
  if (task.agent === 'content' && item && VISUAL_PLATFORMS.has(task.platform?.toLowerCase())) {
    try {
      designerResult = await runDesignerAgent({
        contentItem: item,
        campaignId,
        campaignName,
        channelId,
        slackClient,
        notifySlack: false,
      })
    } catch (err) {
      console.error(`[marketing-director] Designer failed for ${item.id}:`, err.message)
      // Fall back to text-only item
    }
  }

  return { item, designerResult }
}

// Extract bullet points from a formatted report string
function extractBullets(text) {
  if (!text) return null
  const lines = text.split('\n').filter(l => l.trim().startsWith('•') || l.trim().startsWith('-') || l.trim().startsWith('✅') || l.trim().startsWith('⚠️') || l.trim().startsWith('→'))
  return lines.slice(0, 5).join('\n') || text.substring(0, 300)
}
