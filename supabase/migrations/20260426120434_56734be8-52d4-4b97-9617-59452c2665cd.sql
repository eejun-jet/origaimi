-- Extend assessment_comments to support remarks against coverage rows and coach findings
ALTER TABLE public.assessment_comments
  ADD COLUMN IF NOT EXISTS target_kind text,
  ADD COLUMN IF NOT EXISTS target_key text;

ALTER TABLE public.assessment_comments
  DROP CONSTRAINT IF EXISTS assessment_comments_scope_check;

ALTER TABLE public.assessment_comments
  ADD CONSTRAINT assessment_comments_scope_check
  CHECK (scope = ANY (ARRAY['paper'::text, 'section'::text, 'question'::text, 'coverage'::text, 'coach'::text]));

CREATE INDEX IF NOT EXISTS assessment_comments_target_idx
  ON public.assessment_comments (assessment_id, scope, target_kind, target_key);