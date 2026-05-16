-- ============================================================
-- Migration 003: Marketing OS fixes
-- Run in: Supabase SQL Editor
-- ============================================================

-- ── content_log additions ──────────────────────────────────────

-- Content strategy fields
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS content_pillar            text;
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS angle                     text;
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS pillar_selection_reasoning text;
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS angle_selection_reasoning  text;

-- Revision tracking
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS revision_number    integer     not null default 0;
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS parent_content_id  uuid        references content_log(id);
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS rejection_reason   text;

-- Performance data (written 48h after posting by analytics agent)
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS posted_at          timestamptz;
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS performance_data   jsonb       not null default '{}';

-- Reel production status
ALTER TABLE content_log ADD COLUMN IF NOT EXISTS asset_status       text        not null default 'none';

-- ── decisions_log additions ───────────────────────────────────

ALTER TABLE decisions_log ADD COLUMN IF NOT EXISTS rejection_type   text check (rejection_type in ('revise', 'discard'));
ALTER TABLE decisions_log ADD COLUMN IF NOT EXISTS revision_reason  text;
ALTER TABLE decisions_log ADD COLUMN IF NOT EXISTS revision_number  integer not null default 0;

-- Extend the decisions_log decision check to include 'revise' and 'discard'
ALTER TABLE decisions_log DROP CONSTRAINT IF EXISTS decisions_log_decision_check;
ALTER TABLE decisions_log ADD CONSTRAINT decisions_log_decision_check
  CHECK (decision in ('approved', 'rejected', 'revise', 'discard'));

-- ── Indexes for new fields ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_content_log_platform_created  ON content_log (platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_log_performance       ON content_log (posted_at) WHERE performance_data = '{}';
CREATE INDEX IF NOT EXISTS idx_content_log_parent            ON content_log (parent_content_id) WHERE parent_content_id IS NOT NULL;
