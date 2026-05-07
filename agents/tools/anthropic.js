import Anthropic from '@anthropic-ai/sdk'

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY must be set')
}

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const MODELS = {
  ORCHESTRATOR: 'claude-opus-4-7',
  CONTENT:      'claude-sonnet-4-6',
  ADS:          'claude-sonnet-4-6',
  RESEARCH:     'claude-haiku-4-5-20251001',
  ANALYTICS:    'claude-haiku-4-5-20251001',
  SCHEDULER:    'claude-haiku-4-5-20251001',
}
