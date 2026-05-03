ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS scoped_disciplines text[];
ALTER TABLE public.paper_sets ADD COLUMN IF NOT EXISTS scoped_disciplines text[];