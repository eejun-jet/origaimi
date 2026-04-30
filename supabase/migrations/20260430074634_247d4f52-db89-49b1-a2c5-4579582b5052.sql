-- Extend question_bank_items with rich provenance + syllabus tagging
ALTER TABLE public.question_bank_items
  ADD COLUMN IF NOT EXISTS past_paper_id uuid,
  ADD COLUMN IF NOT EXISTS question_number text,
  ADD COLUMN IF NOT EXISTS command_word text,
  ADD COLUMN IF NOT EXISTS source_excerpt text,
  ADD COLUMN IF NOT EXISTS diagram_paths text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS learning_outcomes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS knowledge_outcomes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ao_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS syllabus_doc_id uuid,
  ADD COLUMN IF NOT EXISTS topic_code text,
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS paper_number text,
  ADD COLUMN IF NOT EXISTS exam_board text;

CREATE INDEX IF NOT EXISTS idx_qbi_subject_level_syllabus
  ON public.question_bank_items (subject, level, syllabus_doc_id);

CREATE INDEX IF NOT EXISTS idx_qbi_past_paper_id
  ON public.question_bank_items (past_paper_id);

CREATE INDEX IF NOT EXISTS idx_qbi_source ON public.question_bank_items (source);

CREATE INDEX IF NOT EXISTS idx_qbi_los_gin
  ON public.question_bank_items USING GIN (learning_outcomes);

CREATE INDEX IF NOT EXISTS idx_qbi_kos_gin
  ON public.question_bank_items USING GIN (knowledge_outcomes);

CREATE INDEX IF NOT EXISTS idx_qbi_ao_gin
  ON public.question_bank_items USING GIN (ao_codes);

CREATE INDEX IF NOT EXISTS idx_qbi_tags_gin
  ON public.question_bank_items USING GIN (tags);

-- Link diagrams to a specific extracted question (nullable for legacy rows)
ALTER TABLE public.past_paper_diagrams
  ADD COLUMN IF NOT EXISTS question_id uuid;

CREATE INDEX IF NOT EXISTS idx_diagrams_question_id
  ON public.past_paper_diagrams (question_id);

-- Auto-update updated_at on question_bank_items
DROP TRIGGER IF EXISTS trg_qbi_updated_at ON public.question_bank_items;
CREATE TRIGGER trg_qbi_updated_at
  BEFORE UPDATE ON public.question_bank_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Clean out the 4 stale AI seed rows from earlier dev runs so the bank starts fresh
DELETE FROM public.question_bank_items
WHERE user_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND source = 'ai';