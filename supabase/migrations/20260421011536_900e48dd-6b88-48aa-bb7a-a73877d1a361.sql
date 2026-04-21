
-- New table for Assessment Objectives
CREATE TABLE public.syllabus_assessment_objectives (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_doc_id UUID NOT NULL REFERENCES public.syllabus_documents(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES public.syllabus_papers(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT,
  description TEXT,
  weighting_percent INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_sao_doc ON public.syllabus_assessment_objectives(source_doc_id);
CREATE INDEX idx_sao_paper ON public.syllabus_assessment_objectives(paper_id);

ALTER TABLE public.syllabus_assessment_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read" ON public.syllabus_assessment_objectives FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.syllabus_assessment_objectives FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.syllabus_assessment_objectives FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.syllabus_assessment_objectives FOR DELETE USING (true);

CREATE TRIGGER update_sao_updated_at
  BEFORE UPDATE ON public.syllabus_assessment_objectives
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Extend syllabus_topics
ALTER TABLE public.syllabus_topics
  ADD COLUMN outcome_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN ao_codes TEXT[] NOT NULL DEFAULT '{}';
