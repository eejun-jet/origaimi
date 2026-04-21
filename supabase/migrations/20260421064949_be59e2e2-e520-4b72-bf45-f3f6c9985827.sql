ALTER TABLE public.assessment_questions
  ADD COLUMN IF NOT EXISTS source_excerpt text,
  ADD COLUMN IF NOT EXISTS source_url text;