ALTER TABLE public.assessments
  ADD COLUMN syllabus_doc_id uuid REFERENCES public.syllabus_documents(id) ON DELETE SET NULL,
  ADD COLUMN syllabus_paper_id uuid REFERENCES public.syllabus_papers(id) ON DELETE SET NULL,
  ADD COLUMN syllabus_code text;

CREATE INDEX idx_assessments_syllabus_paper_id ON public.assessments(syllabus_paper_id);
CREATE INDEX idx_assessments_syllabus_doc_id ON public.assessments(syllabus_doc_id);