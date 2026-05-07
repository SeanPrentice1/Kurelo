-- ============================================================
-- Kurelo Agentic Marketing System — Supabase Schema
-- Run in: Supabase SQL Editor (project: ovmlohgptdiryvlwztxz)
-- ============================================================

-- ── 1. Brand Context Memory ───────────────────────────────────
create table if not exists brand_context (
  id           uuid        primary key default gen_random_uuid(),
  product      text        not null check (product in ('crevaxo', 'rostura', 'kurelo')),
  context_type text        not null,   -- 'brand_voice' | 'audience' | 'positioning' | 'competitor' | 'guidelines' | 'tone'
  title        text        not null,
  content      text        not null,
  metadata     jsonb       not null default '{}',
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── 2. Campaign Log ───────────────────────────────────────────
create table if not exists campaign_log (
  id             uuid        primary key default gen_random_uuid(),
  product        text        not null check (product in ('crevaxo', 'rostura')),
  name           text        not null,
  brief          text        not null,
  status         text        not null default 'planning'
                               check (status in ('planning', 'active', 'paused', 'completed', 'failed')),
  task_plan      jsonb,                -- structured plan JSON from orchestrator
  slack_channel  text,                 -- Slack channel ID
  slack_plan_ts  text,                 -- Slack message ts for the plan post
  budget_cents   integer,
  spend_cents    integer     not null default 0,
  metadata       jsonb       not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── 3. Content Log ────────────────────────────────────────────
create table if not exists content_log (
  id               uuid        primary key default gen_random_uuid(),
  campaign_id      uuid        references campaign_log(id) on delete cascade,
  product          text        not null check (product in ('crevaxo', 'rostura')),
  agent            text        not null,   -- 'content' | 'ads' | 'research' | 'analytics'
  task_type        text        not null,   -- e.g. 'instagram_post', 'meta_ad_copy', 'competitor_analysis'
  platform         text,                   -- 'instagram' | 'tiktok' | 'linkedin' | 'reddit' | 'meta_ads' | null
  content_type     text        not null,   -- 'caption' | 'ad_copy' | 'report' | 'insight'
  output           text        not null,   -- the generated text
  metadata         jsonb       not null default '{}',  -- hashtags, image_prompt, cta, variants, etc.
  status           text        not null default 'pending'
                                 check (status in ('pending', 'approved', 'rejected', 'scheduled', 'posted', 'failed')),
  slack_channel    text,
  slack_ts         text,                   -- ts of the approval message in Slack
  buffer_update_id text,                   -- Buffer queue entry ID once scheduled
  scheduled_for    timestamptz,
  approved_at      timestamptz,
  approved_by      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 4. Decisions Log ─────────────────────────────────────────
create table if not exists decisions_log (
  id           uuid        primary key default gen_random_uuid(),
  content_id   uuid        references content_log(id)  on delete cascade,
  campaign_id  uuid        references campaign_log(id) on delete set null,
  decision     text        not null check (decision in ('approved', 'rejected')),
  decided_by   text,        -- Slack user ID or 'web'
  reason       text,
  slack_payload jsonb,
  created_at   timestamptz not null default now()
);

-- ── 5. Asset Library ─────────────────────────────────────────
create table if not exists asset_library (
  id                uuid        primary key default gen_random_uuid(),
  product           text        not null check (product in ('crevaxo', 'rostura')),
  asset_type        text        not null,  -- 'caption' | 'hashtag_set' | 'ad_copy' | 'hook' | 'cta'
  title             text        not null,
  content           text        not null,
  platform          text,
  performance_score numeric(4,2),
  usage_count       integer     not null default 0,
  metadata          jsonb       not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_campaign_log_product  on campaign_log  (product);
create index if not exists idx_campaign_log_status   on campaign_log  (status);
create index if not exists idx_content_log_campaign  on content_log   (campaign_id);
create index if not exists idx_content_log_status    on content_log   (status);
create index if not exists idx_content_log_product   on content_log   (product);
create index if not exists idx_decisions_content     on decisions_log (content_id);
create index if not exists idx_brand_context_product on brand_context  (product, is_active);
create index if not exists idx_asset_library_product on asset_library  (product);

-- ── Auto-update updated_at ────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_campaign_log_updated_at
  before update on campaign_log
  for each row execute function update_updated_at();

create trigger trg_content_log_updated_at
  before update on content_log
  for each row execute function update_updated_at();

create trigger trg_brand_context_updated_at
  before update on brand_context
  for each row execute function update_updated_at();

create trigger trg_asset_library_updated_at
  before update on asset_library
  for each row execute function update_updated_at();

-- ── Seed: Brand Context (source of truth — kurelo-brand-context.md) ──────────
insert into brand_context (product, context_type, title, content) values

  -- ── CREVAXO ────────────────────────────────────────────────────────────────

  (
    'crevaxo', 'positioning', 'What Crevaxo Is',
    'A licensing and project management platform built specifically for creative professionals - photographers, videographers, designers. It combines client management, project workflow, asset library, and a licensing engine into a single tool. The licensing engine is the core reason Crevaxo exists. The industry has never handled the licensing flow properly - no dedicated tool connects assets to legally binding agreements, digital signatures, and payments in one place. Crevaxo exists because that gap is real and costly for creatives. Everything else in the product supports getting to a license.'
  ),
  (
    'crevaxo', 'audience', 'Crevaxo Target Audience',
    'Creative professionals - primarily photographers and videographers. Leaning slightly commercial: advertising, editorial, brand work - rather than purely lifestyle or wedding. These are people who license their work to clients and businesses, track usage rights, and manage multiple projects simultaneously. They are business-minded creatives who take their work seriously but are frustrated by the admin that surrounds it. They know the licensing problem exists. They feel the pain of cobbled-together workflows. They just haven''t found the right tool.'
  ),
  (
    'crevaxo', 'competitors', 'Crevaxo Direct Competitors',
    'HoneyBook, Dubsado, spreadsheets and cobbled-together workflows, Notion (aspirational - Crevaxo is purpose-built rather than a DIY workaround). Key positioning: competitors are generic business tools adapted by creatives. Crevaxo is built from the ground up for the creative licensing workflow. The licensing engine is proprietary and has no direct equivalent in the market.'
  ),
  (
    'crevaxo', 'brand_voice', 'Crevaxo Tone of Voice',
    'Polished and professional but casual in appearance. Think Notion - confident, peer-to-peer, never enterprise, never salesy. Short punchy sentences. Talks to the user like a contemporary, not a vendor. Never over-explains. Confident without being boastful. Occasionally witty but never tries too hard. HARD RULES: No em dashes - hyphens only. No corporate language. No buzzwords. Never sound like enterprise software, a pitch, a press release, or a brand trying too hard to be cool. The goal is top-of-mind awareness built slowly through genuinely useful and relatable content - not conversion. No hard sells. No CTAs that feel pushy. Content should plant a seed, not close a deal.'
  ),
  (
    'crevaxo', 'content_pillars', 'Crevaxo Content Pillars',
    '1. BEHIND THE SCENES: How a real creative uses Crevaxo day to day. Built around Marcus Holt, a fictional Sydney-based commercial photographer working with clients including Coastal Brew Co. Screen recordings of real Crevaxo workflows presented as Marcus''s working day. Never break the fourth wall. Treat as documentary, not demo. 2. LICENSING EDUCATION: Practical, opinionated content about how licensing works, how to price usage rights, what different license types mean, how to protect creative work. Always carries an implicit point of view - the industry handles this badly, creatives are routinely underprotected. Never explicitly sells Crevaxo. 3. PRODUCT FEATURES AND DEEP DIVES: Primarily tutorial-style - here''s how to use X feature step by step. Screen recordings are the primary asset format. Keep copy minimal. 4. INDUSTRY NEWS AND CONTEXT: Relevant industry developments contextualised through the Crevaxo lens - copyright cases, licensing disputes, platform policy changes, shifts in how brands buy creative work.'
  ),
  (
    'crevaxo', 'platform_rules', 'Crevaxo Platform-Specific Rules',
    'INSTAGRAM: Visual first, copy second. Hook in the first line. Short copy, punchy sentences. No paragraphs - line breaks only. Hashtags minimal and relevant, never spammy. LINKEDIN: Slightly more considered tone. Business outcome focused - time saved, revenue protected, workflow improved. Short paragraphs acceptable. Can go slightly longer but still tight. 3-5 hashtags maximum. TIKTOK: Punchy, trend-aware, very short. First 2 seconds must hook - assume zero patience. Copy is secondary to the visual/screen recording. Can be more playful. Tap into relevant trends only where they fit naturally - never forced. REDDIT: Zero sales energy - non-negotiable. Genuinely helpful, conversational tone. Post as a peer in the community. Education and discussion only. No product pushes.'
  ),
  (
    'crevaxo', 'hard_constraints', 'Crevaxo Hard Constraints',
    'NO face on camera. NO voiceover. NO stock photography. NO generic AI-generated imagery unless it fits a specific aesthetic brief. NO em dashes - hyphens only, always. NEVER reference Kurelo publicly. NEVER sound like enterprise software. NEVER pitch directly. NEVER use filler phrases like "In today''s digital world", "As a creative professional", "It''s no secret that". NEVER write content that sounds like it was written by AI. Always vary sentence length.'
  ),
  (
    'crevaxo', 'asset_universe', 'Crevaxo Asset Universe',
    'All screen recordings use Crevaxo''s live product. The fictional creative professional is Marcus Holt - a Sydney-based commercial photographer. His primary mock client is Coastal Brew Co. All fictional workflow content uses this universe for consistency. Never break this fictional frame. Treat all Marcus Holt content as documentary - show his workflow, his client communication, his licensing process - as if it is real.'
  ),

  -- ── ROSTURA ────────────────────────────────────────────────────────────────

  (
    'rostura', 'positioning', 'What Rostura Is',
    'A mobile app for casual workers in Australia. Entirely employee-focused - helps casual workers track shifts, manage pay, and handle tax reporting. Employers have no role in the product. The strongest paid feature is EOFY tax reporting. This is not a financial institution and should never feel like one. It is a simple, fast tool that gives casual workers clarity over their own money.'
  ),
  (
    'rostura', 'audience', 'Rostura Target Audience',
    'Casual workers in Australia. Young, fast-paced, impulsive decision-makers. University students, hospitality workers, retail workers, anyone juggling multiple casual jobs. They do not have time to think, do not want to think, and will move on in seconds if content does not immediately feel relevant. They are not interested in being educated - they want a tool that solves a problem they already know they have. If they have to consider whether this is for them, the post has already failed.'
  ),
  (
    'rostura', 'brand_voice', 'Rostura Tone of Voice',
    'Young, very casual, straight to the point. No room for thinking - the content should make the decision for them. Impulsive-friendly. Short. Punchy. Relatable. Aussie-aware without being try-hard about it. HARD RULES: Keep it brief - always. Never sound like a financial app, corporate, formal, or anything that feels like admin. NEVER reference Kurelo publicly. NEVER use filler phrases. NEVER write content that sounds like AI. No em dashes - hyphens only.'
  ),
  (
    'rostura', 'content_pillars', 'Rostura Content Pillars',
    '1. PAY AWARENESS: Content that makes casual workers think about whether they are being paid correctly. Hooks around underpayment, award rates, penalty rates. Rostura as the tool that gives them clarity. 2. TAX AND EOFY: Demystifying tax for casual workers. EOFY content - what to claim, how to lodge, why it matters. Rostura''s tax reporting feature as the solution. Timely content around July each year. 3. PRODUCT FEATURES: Quick, visual demonstrations of what Rostura does. Shift tracking, pay summaries, tax exports. No tutorials - just "here''s what it does, download it."'
  ),
  (
    'rostura', 'platform_rules', 'Rostura Platform-Specific Rules',
    'TIKTOK AND REELS (primary channel): Hook in the first second. Extremely short - if it can be said in 5 seconds, do not use 10. Trend-aware but only where natural. Relatable scenarios - late shifts, multiple jobs, tax confusion. REDDIT (r/australia, r/AusFinance): Genuinely helpful, zero promotion. Answer questions, provide value, let the product speak for itself through usefulness.'
  ),
  (
    'rostura', 'hard_constraints', 'Rostura Hard Constraints',
    'NO face on camera. NO voiceover. Keep it brief - always. NEVER sound like a financial institution. NEVER reference Kurelo publicly. NEVER use filler phrases. NEVER write content that sounds like AI. No em dashes - hyphens only.'
  ),

  -- ── BOTH PRODUCTS ──────────────────────────────────────────────────────────

  (
    'kurelo', 'agent_rules', 'Agent Content Generation Rules (Both Products)',
    'NEVER generate content that sounds like it was written by AI. NEVER use filler phrases: "In today''s digital world", "As a creative professional", "It''s no secret that", "game-changer", "revolutionise", "leverage", "In conclusion". NEVER use em dashes - hyphens only in all copy. Always vary sentence length - short punchy sentences mixed with slightly longer ones. Always write copy platform-first - what works on Instagram does not work on LinkedIn. Never repeat a content angle within a 3-week window - check content log before generating. All content goes to Slack inbox before any action is taken. Nothing is posted, scheduled, or published without explicit approval. Check decisions log before campaign planning - respect previous approvals and rejections as signals.'
  )

on conflict do nothing;
