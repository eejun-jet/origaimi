-- Join table: a topic can belong to multiple papers (e.g. MCQ Paper 1 draws from
-- both Physics and Chemistry sections of 5086).
CREATE TABLE IF NOT EXISTS public.syllabus_topic_papers (
  topic_id UUID NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  paper_id UUID NOT NULL REFERENCES public.syllabus_papers(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, paper_id)
);

CREATE INDEX IF NOT EXISTS idx_syllabus_topic_papers_paper ON public.syllabus_topic_papers(paper_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_topic_papers_topic ON public.syllabus_topic_papers(topic_id);

ALTER TABLE public.syllabus_topic_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read" ON public.syllabus_topic_papers FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.syllabus_topic_papers FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.syllabus_topic_papers FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.syllabus_topic_papers FOR DELETE USING (true);