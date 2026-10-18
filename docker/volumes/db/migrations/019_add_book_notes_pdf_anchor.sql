-- Migration 019: Add a stable text anchor for annotations shared by fixed and
-- reflowed PDF views. Existing notes remain valid and the field is optional.

ALTER TABLE public.book_notes
  ADD COLUMN IF NOT EXISTS pdf_anchor jsonb NULL;
