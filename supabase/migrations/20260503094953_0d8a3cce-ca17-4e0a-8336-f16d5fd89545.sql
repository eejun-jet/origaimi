ALTER TABLE public.syllabus_documents
  ADD COLUMN IF NOT EXISTS aims text,
  ADD COLUMN IF NOT EXISTS assessment_rationale text,
  ADD COLUMN IF NOT EXISTS pedagogical_notes text,
  ADD COLUMN IF NOT EXISTS command_word_glossary jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS narrative_source_path text;