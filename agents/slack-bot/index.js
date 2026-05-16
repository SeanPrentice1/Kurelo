import { App, ExpressReceiver } from '@slack/bolt'
import { runOrchestrator } from '../orchestrator/index.js'
import { suggestSchedule, executeSchedule } from '../marketing/scheduler-agent/index.js'
import { runContentAgent } from '../marketing/content-agent/index.js'
import { logDecision } from '../tools/memory.js'
import { resolvedBlocks, approvalBlocks } from '../tools/slack.js'
import { reelThreads } from '../tools/reel-state.js'
import supabase from '../tools/supabase.js'

// In-memory store for pending revision threads: originalMessageTs → { contentId, requestedBy, channelId, campaignId, originalOutput, taskType }
const revisionThreads = new Map()

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

  // ── Reject button (legacy — kept for backwards compatibility) ─────────────
  app.action('reject_content', async ({ action, ack, body, client }) => {
    await ack()

    const contentId  = action.value
    const userId     = body.user.id
    const channelId  = body.container?.channel_id
    const messageTts = body.container?.message_ts

    console.log(`[slack-bot] Reject (legacy): ${contentId} by ${userId}`)

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
        campaignId:    item.campaign_id,
        decision:      'rejected',
        decidedBy:     userId,
        rejectionType: 'discard',
        slackPayload:  { action_id: action.action_id, channel: channelId },
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

  // ── Revise button ──────────────────────────────────────────
  app.action('revise_content', async ({ action, ack, body, client }) => {
    await ack()

    const contentId  = action.value
    const userId     = body.user.id
    const channelId  = body.container?.channel_id
    const messageTts = body.container?.message_ts

    console.log(`[slack-bot] Revise: ${contentId} by ${userId}`)

    try {
      const { data: item, error } = await supabase
        .from('content_log')
        .select('campaign_id, output, agent, task_type, revision_number')
        .eq('id', contentId)
        .single()

      if (error) throw new Error(error.message)

      const currentRevision = item.revision_number ?? 0

      // Maximum 3 revisions — flag for manual review if exceeded
      if (currentRevision >= 3) {
        if (channelId) {
          await client.chat.postMessage({
            channel: channelId,
            text:    `⚠️ *Needs manual review* — this post has been revised 3 times without approval. Please review and handle manually.\nContent ID: \`${contentId}\``,
          })
        }
        return
      }

      // Update message to show revise-requested state
      if (channelId && messageTts) {
        await client.chat.update({
          channel: channelId,
          ts:      messageTts,
          text:    `📝 Revise requested by <@${userId}>`,
          blocks:  resolvedBlocks({
            decision:  'revise',
            decidedBy: userId,
            output:    item.output,
            agent:     item.agent,
            taskType:  item.task_type,
          }),
        })
      }

      // Post thread message prompting for revision reason
      if (channelId && messageTts) {
        await client.chat.postMessage({
          channel:   channelId,
          thread_ts: messageTts,
          text:      `What needs changing? Reply to this thread.`,
        })
        // Track this thread so we capture the reply
        revisionThreads.set(messageTts, { contentId, requestedBy: userId, channelId, campaignId: item.campaign_id, originalOutput: item.output, taskType: item.task_type })
      }
    } catch (err) {
      console.error('[slack-bot] Revise error:', err)
      if (channelId) {
        await client.chat.postMessage({
          channel: channelId,
          text:    `❌ Revise failed: ${err.message}`,
        })
      }
    }
  })

  // ── Discard button ─────────────────────────────────────────
  app.action('discard_content', async ({ action, ack, body, client }) => {
    await ack()

    const contentId  = action.value
    const userId     = body.user.id
    const channelId  = body.container?.channel_id
    const messageTts = body.container?.message_ts

    console.log(`[slack-bot] Discard: ${contentId} by ${userId}`)

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
        campaignId:    item.campaign_id,
        decision:      'discard',
        decidedBy:     userId,
        rejectionType: 'discard',
        slackPayload:  { action_id: action.action_id, channel: channelId },
      })

      if (channelId && messageTts) {
        await client.chat.update({
          channel: channelId,
          ts:      messageTts,
          text:    `🗑️ Discarded by <@${userId}>`,
          blocks:  resolvedBlocks({
            decision:  'discard',
            decidedBy: userId,
            output:    item.output,
            agent:     item.agent,
            taskType:  item.task_type,
          }),
        })
      }

      // Brief Slack confirmation
      if (channelId) {
        await client.chat.postMessage({
          channel:   channelId,
          thread_ts: messageTts,
          text:      `🗑️ Discarded — no retry. Logged.`,
        })
      }
    } catch (err) {
      console.error('[slack-bot] Discard error:', err)
      if (channelId) {
        await client.chat.postMessage({
          channel: channelId,
          text:    `❌ Discard failed: ${err.message}`,
        })
      }
    }
  })

  // ── Thread message handler — captures revision reasons and reel recordings ──
  app.event('message', async ({ event, client }) => {
    // Ignore bot messages and messages without a thread
    if (event.bot_id || event.subtype === 'bot_message') return
    if (!event.thread_ts) return

    // ── Revision reply ──────────────────────────────────────
    if (revisionThreads.has(event.thread_ts)) {
      const ctx = revisionThreads.get(event.thread_ts)
      revisionThreads.delete(event.thread_ts)

      const revisionReason = event.text?.trim()
      if (!revisionReason) return

      console.log(`[slack-bot] Revision reason captured for ${ctx.contentId}: "${revisionReason.substring(0, 80)}"`)

      // Fetch original content to get revision_number and task info
      const { data: original } = await supabase
        .from('content_log')
        .select('*')
        .eq('id', ctx.contentId)
        .single()

      if (!original) return

      const nextRevision = (original.revision_number ?? 0) + 1

      // Log decision with revision context
      await logDecision({
        contentId:      ctx.contentId,
        campaignId:     ctx.campaignId,
        decision:       'revise',
        decidedBy:      ctx.requestedBy,
        rejectionType:  'revise',
        revisionReason,
        revisionNumber: nextRevision,
        slackPayload:   { thread_ts: event.thread_ts, channel: ctx.channelId },
      })

      // Notify channel that revision is being generated
      await client.chat.postMessage({
        channel:   ctx.channelId,
        thread_ts: event.thread_ts,
        text:      `✏️ Got it — revising now. Revision ${nextRevision}/3.`,
      })

      // Re-run content agent with revision context
      try {
        const newItem = await runContentAgent({
          task: {
            type:         original.task_type,
            agent:        'content',
            platform:     original.platform,
            product:      original.product,
            description:  `Revised version of: ${original.task_type}`,
            params:       original.metadata ?? {},
          },
          campaignId:   original.campaign_id,
          campaignName: `${original.task_type} — rev${nextRevision}`,
          channelId:    ctx.channelId,
          slackClient:  client,
          revisionContext: {
            reason:       revisionReason,
            originalCopy: original.output,
          },
        })

        // Update revision_number on the new item and mark parent
        await supabase
          .from('content_log')
          .update({
            revision_number:  nextRevision,
            parent_content_id: ctx.contentId,
            rejection_reason: revisionReason,
          })
          .eq('id', newItem.id)

        // Post the revised item for approval
        const msg = await client.chat.postMessage({
          channel: ctx.channelId,
          text:    `✏️ Revision ${nextRevision} ready for approval`,
          blocks:  approvalBlocks({
            contentId:    newItem.id,
            campaignName: `Rev ${nextRevision}`,
            agent:        newItem.agent,
            taskType:     newItem.task_type,
            platform:     newItem.platform,
            output:       newItem.output,
            metadata:     newItem.metadata,
          }),
        })

        await supabase
          .from('content_log')
          .update({ slack_ts: msg.ts })
          .eq('id', newItem.id)
      } catch (err) {
        console.error(`[slack-bot] Revision generation failed for ${ctx.contentId}:`, err)
        await client.chat.postMessage({
          channel:   ctx.channelId,
          thread_ts: event.thread_ts,
          text:      `❌ Revision failed: ${err.message}`,
        })
      }
      return
    }

    // ── Reel recording attachment ────────────────────────────
    if (reelThreads.has(event.thread_ts) && event.files?.length) {
      const ctx = reelThreads.get(event.thread_ts)
      const file = event.files[0]

      console.log(`[slack-bot] Reel recording received for ${ctx.contentId}: ${file.name}`)

      try {
        // Download file from Slack
        const fileRes = await fetch(file.url_private_download, {
          headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        })
        if (!fileRes.ok) throw new Error(`Slack file download failed: ${fileRes.status}`)
        const arrayBuffer = await fileRes.arrayBuffer()
        const fileBuffer  = Buffer.from(arrayBuffer)

        // Store to Supabase Storage /reels/[campaign_id]/
        const ext         = file.name?.split('.').pop() ?? 'mp4'
        const storagePath = `reels/${ctx.campaignId}/${ctx.contentId}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('agent-assets')
          .upload(storagePath, fileBuffer, { contentType: file.mimetype ?? 'video/mp4', upsert: true })

        if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

        const { data: { publicUrl } } = supabase.storage
          .from('agent-assets')
          .getPublicUrl(storagePath)

        // Update asset_status to production_complete, merging recording info into existing metadata
        const { data: existing } = await supabase.from('content_log').select('metadata').eq('id', ctx.contentId).single()
        await supabase
          .from('content_log')
          .update({
            asset_status: 'production_complete',
            status:       'approved',
            approved_at:  new Date().toISOString(),
            metadata:     { ...(existing?.metadata ?? {}), recording_url: publicUrl, storage_path: storagePath },
          })
          .eq('id', ctx.contentId)

        reelThreads.delete(event.thread_ts)

        await client.chat.postMessage({
          channel:   ctx.channelId,
          thread_ts: event.thread_ts,
          text:      `✅ Recording received and stored. Generating schedule options...`,
        })

        // Trigger schedule approval automatically
        suggestSchedule({ contentId: ctx.contentId, channelId: ctx.channelId, slackClient: client }).catch(err => {
          console.error(`[slack-bot] suggestSchedule after reel upload failed:`, err)
        })
      } catch (err) {
        console.error(`[slack-bot] Reel upload failed for ${ctx.contentId}:`, err)
        await client.chat.postMessage({
          channel:   ctx.channelId,
          thread_ts: event.thread_ts,
          text:      `❌ Recording upload failed: ${err.message}`,
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
