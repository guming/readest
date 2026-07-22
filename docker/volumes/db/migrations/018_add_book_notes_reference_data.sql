-- Migration 018: Add structured metadata for native Notebook references.
-- Existing annotations, excerpts and bookmarks remain unchanged.

ALTER TABLE public.book_notes
  ADD COLUMN IF NOT EXISTS reference_data jsonb NULL;
