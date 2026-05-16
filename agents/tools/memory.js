import supabase from './supabase.js'

export async function getBrandContext(product) {
  const { data, error } = await supabase
    .from('brand_context')
    .select('context_type, title, content')
    .eq('product', product)
    .eq('is_active', true)
    .order('context_type')

  if (error) throw new Error(`Brand context fetch failed: ${error.message}`)
  return data ?? []
}

export async function getRecentCampaigns(product, limit = 5) {
  const { data, error } = await supabase
    .from('campaign_log')
    .select('name, brief, status, created_at')
    .eq('product', product)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Campaign history fetch failed: ${error.message}`)
  return data ?? []
}

export async function getTopAssets(product, platform = null, limit = 8) {
  let query = supabase
    .from('asset_library')
    .select('asset_type, title, content, platform, performance_score')
    .eq('product', product)
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (platform) query = query.eq('platform', platform)

  const { data, error } = await query
  if (error) throw new Error(`Asset fetch failed: ${error.message}`)
  return data ?? []
}

export async function buildMemoryContext(product, platform = null) {
  const [brand, recentCampaigns, topAssets] = await Promise.all([
    getBrandContext(product),
    getRecentCampaigns(product),
    getTopAssets(product, platform),
  ])
  return { brand, recentCampaigns, topAssets }
}

export function formatMemoryContext(memory) {
  const parts = []

  if (memory.brand?.length) {
    parts.push('=== BRAND CONTEXT ===')
    for (const b of memory.brand) {
      parts.push(`[${b.context_type.toUpperCase()}] ${b.title}\n${b.content}`)
    }
  }

  if (memory.recentCampaigns?.length) {
    parts.push('\n=== RECENT CAMPAIGNS ===')
    for (const c of memory.recentCampaigns) {
      parts.push(`• ${c.name} (${c.status}) — ${c.brief.substring(0, 120)}`)
    }
  }

  if (memory.topAssets?.length) {
    parts.push('\n=== TOP PERFORMING ASSETS ===')
    for (const a of memory.topAssets.slice(0, 4)) {
      parts.push(`• [${a.asset_type}${a.platform ? ` / ${a.platform}` : ''}] ${a.content.substring(0, 200)}`)
    }
  }

  return parts.join('\n')
}

export async function logDecision({ contentId, campaignId, decision, decidedBy, reason = null, slackPayload = null, rejectionType = null, revisionReason = null, revisionNumber = 0 }) {
  const { error } = await supabase.from('decisions_log').insert({
    content_id:     contentId,
    campaign_id:    campaignId ?? null,
    decision,
    decided_by:     decidedBy,
    reason,
    slack_payload:  slackPayload,
    rejection_type: rejectionType,
    revision_reason: revisionReason,
    revision_number: revisionNumber,
  })
  if (error) throw new Error(`Decision log failed: ${error.message}`)
}

/**
 * Fetch recent content_log rows for a product+platform within the last N days.
 * Used by content agent to avoid repeating angles and pillars.
 */
export async function getRecentContent(product, platform, days = 21) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('content_log')
    .select('content_pillar, angle, output, created_at, status')
    .eq('product', product)
    .eq('platform', platform)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    console.warn(`[memory] getRecentContent failed: ${error.message}`)
    return []
  }
  return data ?? []
}

/**
 * Persist a posting_strategy object against a campaign record.
 * Only writes if the strategy has platform_windows data.
 * Silently no-ops if campaignId is falsy.
 */
export async function savePostingStrategy(campaignId, postingStrategy) {
  if (!campaignId || !postingStrategy?.platform_windows) return
  const { error } = await supabase
    .from('campaign_log')
    .update({ posting_strategy: postingStrategy })
    .eq('id', campaignId)
  if (error) console.error(`[memory] savePostingStrategy failed for campaign ${campaignId}: ${error.message}`)
}

/**
 * Retrieve the posting_strategy stored against a campaign.
 * Returns null if the campaign doesn't exist, has no strategy, or the
 * posting_strategy column is missing (migration not yet run).
 */
export async function getCampaignPostingStrategy(campaignId) {
  if (!campaignId) return null
  const { data, error } = await supabase
    .from('campaign_log')
    .select('posting_strategy')
    .eq('id', campaignId)
    .single()
  if (error) {
    // PGRST116 = row not found; any other code likely means the column is missing
    if (error.code !== 'PGRST116') {
      console.error(`[memory] getCampaignPostingStrategy error (campaign ${campaignId}): ${error.code} ${error.message} — has the posting_strategy migration been run?`)
    }
    return null
  }
  const strategy = data?.posting_strategy ?? null
  if (!strategy) console.warn(`[memory] No posting_strategy found for campaign ${campaignId}`)
  return strategy
}

export async function promoteToAssetLibrary(contentId) {
  const { data: item, error } = await supabase
    .from('content_log')
    .select('*')
    .eq('id', contentId)
    .single()

  if (error || !item) return

  await supabase.from('asset_library').insert({
    product:    item.product,
    asset_type: item.content_type,
    title:      `${item.platform ?? item.agent} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    content:    item.output,
    platform:   item.platform,
    metadata:   item.metadata,
  })
}
