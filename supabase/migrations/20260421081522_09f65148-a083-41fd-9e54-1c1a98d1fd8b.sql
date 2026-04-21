ALTER TABLE public.past_papers
  ADD COLUMN IF NOT EXISTS questions_json jsonb,
  ADD COLUMN IF NOT EXISTS style_summary text;

CREATE INDEX IF NOT EXISTS idx_past_papers_subject_level_status
  ON public.past_papers (subject, level, parse_status);