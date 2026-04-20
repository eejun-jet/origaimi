-- Create syllabus_papers table
CREATE TABLE public.syllabus_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_doc_id uuid NOT NULL REFERENCES public.syllabus_documents(id) ON DELETE CASCADE,
  paper_number text NOT NULL,
  paper_code text,
  component_name text,
  marks integer,
  weighting_percent integer,
  duration_minutes integer,
  topic_theme text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for lookups by document
CREATE INDEX idx_syllabus_papers_source_doc_id ON public.syllabus_papers(source_doc_id);

-- Enable RLS with trial-open policies (matching sibling tables)
ALTER TABLE public.syllabus_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read" ON public.syllabus_papers FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.syllabus_papers FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.syllabus_papers FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.syllabus_papers FOR DELETE USING (true);

-- Auto-update updated_at
CREATE TRIGGER update_syllabus_papers_updated_at
BEFORE UPDATE ON public.syllabus_papers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add paper_id to syllabus_topics
ALTER TABLE public.syllabus_topics
ADD COLUMN paper_id uuid REFERENCES public.syllabus_papers(id) ON DELETE SET NULL;

CREATE INDEX idx_syllabus_topics_paper_id ON public.syllabus_topics(paper_id);