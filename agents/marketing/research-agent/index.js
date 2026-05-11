import { anthropic, MODELS } from '../../tools/anthropic.js'
import { getBrandContext } from '../../tools/memory.js'
import { RESEARCH_SYSTEM_PROMPT } from '../../prompts/research.js'

// Built-in Anthropic web search tool — Anthropic executes searches server-side.
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search' }

export async function runResearchAgent({ task, campaignId, campaignName, channelId, slackClient, dependencyContext = [], notifySlack = true }) {
  const { product, description, params = {} } = task
  console.log(`[research-agent] Running: ${task.type} for ${product}`)

  const brand = await getBrandContext(product)
  const userMessage = buildPrompt({ product, description, params, brand })

  const response = await anthropic.messages.create({
    model:      MODELS.RESEARCH,
    max_tokens: 4096,
    system: [
      {
        type:          'text',
        text:          RESEARCH_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools:    [WEB_SEARCH_TOOL],
    messages: [{ role: 'user', content: userMessage }],
  })

  // Web search responses may contain server_tool_use / server_tool_result blocks
  // mixed with text blocks. Extract the last text block which holds the final JSON.
  const textBlocks = (response.content ?? []).filter(b => b.type === 'text')
  const rawText    = textBlocks.at(-1)?.text ?? response.content[0]?.text ?? ''

  const parsed     = parseOutput(rawText)
  const outputText = formatReport(parsed)

  console.log(`[research-agent] Done: ${task.type} (posting_strategy platforms: ${Object.keys(parsed.posting_strategy?.platform_windows ?? {}).join(', ') || 'none'})`)

  // Research is internal — not persisted to content_log (no approval needed)
  return {
    agent:            'research',
    task_type:        task.type,
    product,
    output:           outputText,
    posting_strategy: parsed.posting_strategy ?? null,
    metadata: {
      summary:          parsed.summary         ?? '',
      key_findings:     parsed.key_findings    ?? [],
      opportunities:    parsed.opportunities   ?? [],
      threats:          parsed.threats         ?? [],
      recommendations:  parsed.recommendations ?? [],
      keywords:         parsed.keywords        ?? [],
      posting_strategy: parsed.posting_strategy ?? null,
    },
  }
}

function buildPrompt({ product, description, params, brand }) {
  const parts = [
    `Product: ${product}`,
    `Research Task: ${description}`,
  ]

  if (params && Object.keys(params).length) {
    parts.push(`\nParameters:\n${JSON.stringify(params, null, 2)}`)
  }

  if (brand?.length) {
    parts.push('\nBrand Context:')
    for (const b of brand) parts.push(`[${b.context_type}] ${b.content}`)
  }

  return parts.join('\n')
}

function formatReport(parsed) {
  const sections = []
  if (parsed.summary)                       sections.push(`Summary: ${parsed.summary}`)
  if (parsed.key_findings?.length)          sections.push(`Key Findings:\n${parsed.key_findings.map(f => `- ${f}`).join('\n')}`)
  if (parsed.opportunities?.length)         sections.push(`Opportunities:\n${parsed.opportunities.map(o => `- ${o}`).join('\n')}`)
  if (parsed.threats?.length)               sections.push(`Threats:\n${parsed.threats.map(t => `- ${t}`).join('\n')}`)
  if (parsed.recommendations?.length)       sections.push(`Recommendations:\n${parsed.recommendations.map(r => `- ${r}`).join('\n')}`)
  if (parsed.keywords?.length)              sections.push(`Keywords: ${parsed.keywords.join(', ')}`)
  if (parsed.posting_strategy?.rationale)   sections.push(`Posting Strategy: ${parsed.posting_strategy.rationale}`)
  return sections.join('\n\n')
}

function parseOutput(raw) {
  try {
    return JSON.parse(raw.trim())
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)
    if (match) {
      try { return JSON.parse(match[1] ?? match[0]) } catch { /* fall through */ }
    }
    return { summary: raw.trim(), key_findings: [], opportunities: [], threats: [], recommendations: [] }
  }
}
