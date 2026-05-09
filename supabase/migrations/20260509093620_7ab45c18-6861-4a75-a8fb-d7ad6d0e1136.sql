ALTER TABLE public.marking_papers ADD COLUMN IF NOT EXISTS import_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_marking_papers_import_id ON public.marking_papers(import_id);