ALTER TABLE public.past_papers
  ADD COLUMN IF NOT EXISTS difficulty_fingerprint jsonb;

CREATE INDEX IF NOT EXISTS idx_past_papers_subject_level_specimen
  ON public.past_papers (subject, level)
  WHERE difficulty_fingerprint IS NOT NULL;