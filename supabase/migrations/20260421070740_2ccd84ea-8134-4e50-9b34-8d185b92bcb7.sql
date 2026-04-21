-- Add diagram fields to assessment_questions
ALTER TABLE public.assessment_questions
  ADD COLUMN IF NOT EXISTS diagram_url text,
  ADD COLUMN IF NOT EXISTS diagram_source text,
  ADD COLUMN IF NOT EXISTS diagram_citation text,
  ADD COLUMN IF NOT EXISTS diagram_caption text;

-- Past papers repository
CREATE TABLE IF NOT EXISTS public.past_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  subject text,
  level text,
  year integer,
  paper_number text,
  exam_board text DEFAULT 'MOE',
  file_path text NOT NULL,
  parse_status text NOT NULL DEFAULT 'pending',
  parse_error text,
  page_count integer,
  topics text[] DEFAULT '{}'::text[],
  question_types text[] DEFAULT '{}'::text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.past_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read" ON public.past_papers FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.past_papers FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.past_papers FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.past_papers FOR DELETE USING (true);

CREATE TRIGGER update_past_papers_updated_at
BEFORE UPDATE ON public.past_papers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_past_papers_subject_level ON public.past_papers (subject, level);
CREATE INDEX IF NOT EXISTS idx_past_papers_topics ON public.past_papers USING GIN (topics);

-- Past-paper diagrams
CREATE TABLE IF NOT EXISTS public.past_paper_diagrams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.past_papers(id) ON DELETE CASCADE,
  page_number integer,
  image_path text NOT NULL,
  caption text,
  topic_tags text[] DEFAULT '{}'::text[],
  bbox jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.past_paper_diagrams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read" ON public.past_paper_diagrams FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.past_paper_diagrams FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.past_paper_diagrams FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.past_paper_diagrams FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_past_paper_diagrams_paper ON public.past_paper_diagrams (paper_id);
CREATE INDEX IF NOT EXISTS idx_past_paper_diagrams_topics ON public.past_paper_diagrams USING GIN (topic_tags);

-- Storage buckets
INSERT INTO storage.buckets (id, name, public)
  VALUES ('papers', 'papers', false)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('diagrams', 'diagrams', true)
  ON CONFLICT (id) DO NOTHING;

-- Open trial-mode policies for the two new buckets
CREATE POLICY "Trial papers read" ON storage.objects FOR SELECT USING (bucket_id = 'papers');
CREATE POLICY "Trial papers insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'papers');
CREATE POLICY "Trial papers update" ON storage.objects FOR UPDATE USING (bucket_id = 'papers');
CREATE POLICY "Trial papers delete" ON storage.objects FOR DELETE USING (bucket_id = 'papers');

CREATE POLICY "Trial diagrams read" ON storage.objects FOR SELECT USING (bucket_id = 'diagrams');
CREATE POLICY "Trial diagrams insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'diagrams');
CREATE POLICY "Trial diagrams update" ON storage.objects FOR UPDATE USING (bucket_id = 'diagrams');
CREATE POLICY "Trial diagrams delete" ON storage.objects FOR DELETE USING (bucket_id = 'diagrams');