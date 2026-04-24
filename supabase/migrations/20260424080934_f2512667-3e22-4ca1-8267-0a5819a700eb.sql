ALTER TABLE public.assessment_questions
  ADD COLUMN IF NOT EXISTS ao_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS learning_outcomes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS knowledge_outcomes text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_assessment_questions_ao_codes ON public.assessment_questions USING GIN (ao_codes);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_knowledge_outcomes ON public.assessment_questions USING GIN (knowledge_outcomes);