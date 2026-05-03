CREATE TABLE public.paper_sets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  subject text,
  level text,
  syllabus_doc_id uuid REFERENCES public.syllabus_documents(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paper_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.paper_sets FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.paper_sets FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.paper_sets FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.paper_sets FOR DELETE USING (true);
CREATE TRIGGER update_paper_sets_updated_at BEFORE UPDATE ON public.paper_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.paper_set_papers (
  set_id uuid NOT NULL REFERENCES public.paper_sets(id) ON DELETE CASCADE,
  paper_id uuid NOT NULL REFERENCES public.past_papers(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, paper_id)
);
CREATE INDEX idx_paper_set_papers_set ON public.paper_set_papers(set_id);
CREATE INDEX idx_paper_set_papers_paper ON public.paper_set_papers(paper_id);
ALTER TABLE public.paper_set_papers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.paper_set_papers FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.paper_set_papers FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.paper_set_papers FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.paper_set_papers FOR DELETE USING (true);

CREATE TABLE public.paper_set_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES public.paper_sets(id) ON DELETE CASCADE,
  user_id uuid,
  ran_at timestamptz NOT NULL DEFAULT now(),
  model text,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_paper_set_reviews_set ON public.paper_set_reviews(set_id, ran_at DESC);
ALTER TABLE public.paper_set_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.paper_set_reviews FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.paper_set_reviews FOR INSERT WITH CHECK (true);