import { App, ExpressReceiver } from '@slack/bolt'
import { runOrchestrator } from '../orchestrator/index.js'
import { suggestSchedule, executeSchedule } from '../marketing/scheduler-agent/index.js'
import { logDecision } from '../tools/memory.js'
import { resolvedBlocks } from '../tools/slack.js'
import supabase from '../tools/supabase.js'

/**
 * Creates and configures the Slack Bolt app.
 * Uses ExpressReceiver so the Railway server can add a /health route
 * to the same HTTP server.
 */
export function createSlackApp() {
  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    endpoints:     '/slack/events',
  })

  const app = new App({
    token:    process.env.SLACK_BOT_TOKEN,
    receiver,
  })

  // ── /kurelo [brief] slash command ─────────────────────────
  app.command('/kurelo', async ({ command, ack, client }) => {
    await ack()

    const text = command.text?.trim()
    if (!text) {
      await client.chat.postMessage({
        channel: command.channel_id,
        text: '👋 Usage: `/kurelo [optional: crevaxo|rostura] your brief here`\n\nExample:\n`/kurelo crevaxo launch campaign for our new automation feature targeting solo founders`',
      })
      return
    }

    // Detect product from the brief (default to crevaxo)
    const product = detectProduct(text)

    await client.chat.postMessage({
      channel: command.channel_id,
      text:    `Got it — planning a *${product}* campaign ⚡\n> _${text.substring(0, 120)}${text.length > 120 ? '…' : ''}_`,
    })

    // Run orchestrator async (Slack expects ack within 3s, which we already sent)
    runOrchestrator({
      brief:     text,
      product,
      channelId: command.channel_id,
      userId:    command.user_id,
      slackClient: client,
    }).catch(err => {
      console.error('[slack-bot] Orchestrator error:', err)
      client.chat.postMessage({
        channel: command.channel_id,
        text:    `❌ Orchestrator error: ${err.message}`,
      })
    })
  })

  // ── Approve button ─────────────────────────────────────────
  app.action('approve_content', async ({ action, ack, body, client }) => {
    await ack()

    const contentId  = action.value
    const userId     = body.user.id
    const channelId  = body.container?.channel_id
    const messageTts = body.container?.message_ts

    console.log(`[slack-bot] Approve: ${contentId} by ${userId}`)

    try {
      // Mark approved in DB
      const { data: item, error } = await supabase
        .from('content_log')
        .update({
          status:      'approved',
          approved_at: new Date().toISOString(),
          approved_by: userId,
        })
        .eq('id', contentId)
        .select('campaign_id, output, agent, task_type')
        .single()

      if (error) throw new Error(error.message)

      // Log decision
      await logDecision({
        contentId,
        campaignId:   item.campaign_id,
        decision:     'approved',
        decidedBy:    userId,
        slackPayload: { action_id: action.action_id, channel: channelId },
      })

      // Update the Slack message to show resolved state
      if (channelId && messageTts) {
        await client.chat.update({
          channel: channelId,
          ts:      messageTts,
          text:    `✅ Approved by <@${userId}>`,
          blocks:  resolvedBlocks({
            decision:  'approved',
            decidedBy: userId,
            output:    item.output,
            agent:     item.agent,
            taskType:  item.task_type,
          }),
        })
      }

      // Suggest a schedule slot — does NOT post to Zernio yet
      suggestSchedule({ contentId, channelId, slackClient: client }).catch(err => {
        console.error(`[slack-bot] suggestSchedule error for ${contentId}:`, err)
      })
    } catch (err) {
      console.error('[slack-bot] Approve error:', err)
      if (channelId) {
        await client.chat.postMessage({
          channel: channelId,
          text:    `❌ Approval failed: ${err.message}`,
        })
      }
    }
  })

  // ── Reject button ──────────────────────────────────────────
  app.action('reject_content', async ({ action, ack, body, client }) => {
    await ack()

    const contentId  = action.value
    const userId     = body.user.id
    const channelId  = body.container?.channel_id
    const messageTts = body.container?.message_ts

    console.log(`[slack-bot] Reject: ${contentId} by ${userId}`)

    try {
      const { data: item, error } = await supabase
        .from('content_log')
        .update({ status: 'rejected' })
        .eq('id', contentId)
        .select('campaign_id, output, agent, task_type')
        .single()

      if (error) throw new Error(error.message)

      await logDecision({
        contentId,
        campaignId:   item.campaign_id,
        decision:     'rejected',
        decidedBy:    userId,
        slackPayload: { action_id: action.action_id, channel: channelId },
      })

      if (channelId && messageTts) {
        await client.chat.update({
          channel: channelId,
          ts:      messageTts,
          text:    `❌ Rejected by <@${userId}>`,
          blocks:  resolvedBlocks({
            decision:  'rejected',
            decidedBy: userId,
            output:    item.output,
            agent:     item.agent,
            taskType:  item.task_type,
          }),
        })
      }
    } catch (err) {
      console.error('[slack-bot] Reject error:', err)
      if (channelId) {
        await client.chat.postMessage({
          channel: channelId,
          text:    `❌ Rejection failed: ${err.message}`,
        })
      }
    }
  })

  // ── Confirm schedule button ────────────────────────────────
  app.action(/^confirm_schedule_\d+$/, async ({ action, ack, body, client }) => {
    await ack()

    // value is encoded as "contentId|isoDate"
    const [contentId, isoDate] = action.value.split('|')
    const scheduledAt = new Date(isoDate)
    const channelId   = body.container?.channel_id
    const messageTs   = body.container?.message_ts

    console.log(`[slack-bot] Schedule confirmed: ${contentId} for ${isoDate}`)

    executeSchedule({ contentId, scheduledAt, channelId, messageTs, slackClient: client }).catch(err => {
      console.error(`[slack-bot] executeSchedule error for ${contentId}:`, err)
    })
  })

  return { app, start: (port) => app.start(port) }
}

function detectProduct(text) {
  const lower = text.toLowerCase()
  if (lower.includes('rostura')) return 'rostura'
  if (lower.includes('crevaxo')) return 'crevaxo'
  // Default to crevaxo if unspecified
  return 'crevaxo'
}
