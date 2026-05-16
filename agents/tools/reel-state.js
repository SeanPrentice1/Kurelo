// Shared in-memory state for reel thread tracking.
// Both orchestrator and slack-bot import from here to avoid circular dependencies.

// messageTs → { contentId, campaignId, channelId }
export const reelThreads = new Map()

export function registerReelThread({ messageTs, contentId, campaignId, channelId }) {
  reelThreads.set(messageTs, { contentId, campaignId, channelId })
  console.log(`[reel-state] Thread registered: ${messageTs} → ${contentId}`)
}
