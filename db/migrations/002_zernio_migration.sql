-- ============================================================
-- Migration 002: PostFast → Zernio
-- Run in: Supabase SQL Editor
-- ============================================================

-- Rename postfast_post_id → zernio_post_id (if the column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_log' AND column_name = 'postfast_post_id'
  ) THEN
    ALTER TABLE content_log RENAME COLUMN postfast_post_id TO zernio_post_id;
  END IF;
END $$;

-- Add zernio_post_id if it was never created under the old name either
ALTER TABLE content_log
  ADD COLUMN IF NOT EXISTS zernio_post_id text;
