
-- Syllabus documents (uploaded MOE syllabus papers)
CREATE TABLE public.syllabus_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  title text NOT NULL,
  syllabus_code text,           -- e.g. "2260/01", "6091" (text to preserve leading zeros / slashes)
  paper_code text,              -- e.g. "01", "02"
  exam_board text DEFAULT 'MOE',-- "MOE" | "SEAB" | "Cambridge"
  syllabus_year integer,        -- e.g. 2021
  subject text,
  level text,
  file_path text NOT NULL,
  mime_type text,
  parse_status text NOT NULL DEFAULT 'pending', -- pending|parsing|parsed|failed|published
  parse_error text,
  raw_text text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.syllabus_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read"   ON public.syllabus_documents FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.syllabus_documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.syllabus_documents FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.syllabus_documents FOR DELETE USING (true);

CREATE TRIGGER trg_syllabus_documents_updated_at
BEFORE UPDATE ON public.syllabus_documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_syllabus_documents_subject_level ON public.syllabus_documents (subject, level);
CREATE INDEX idx_syllabus_documents_status ON public.syllabus_documents (parse_status);

-- Syllabus topics (extracted topic tree per document)
CREATE TABLE public.syllabus_topics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_doc_id uuid NOT NULL REFERENCES public.syllabus_documents(id) ON DELETE CASCADE,
  topic_code text,                  -- e.g. "1.2.3" or "MA.P5.NUM.3" (verbatim, nullable)
  parent_code text,                 -- hierarchy reference
  learning_outcome_code text,       -- e.g. "LO-1.2.3a"
  strand text,
  sub_strand text,
  title text NOT NULL,
  learning_outcomes text[] DEFAULT '{}'::text[],
  suggested_blooms text[] DEFAULT '{}'::text[],
  depth integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  subject text,
  level text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.syllabus_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read"   ON public.syllabus_topics FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.syllabus_topics FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.syllabus_topics FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.syllabus_topics FOR DELETE USING (true);

CREATE TRIGGER trg_syllabus_topics_updated_at
BEFORE UPDATE ON public.syllabus_topics
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_syllabus_topics_doc ON public.syllabus_topics (source_doc_id);
CREATE INDEX idx_syllabus_topics_subject_level ON public.syllabus_topics (subject, level);
CREATE INDEX idx_syllabus_topics_parent ON public.syllabus_topics (parent_code);

-- Storage bucket for uploaded syllabi
INSERT INTO storage.buckets (id, name, public) VALUES ('syllabi', 'syllabi', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Trial syllabi read"   ON storage.objects FOR SELECT USING (bucket_id = 'syllabi');
CREATE POLICY "Trial syllabi insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'syllabi');
CREATE POLICY "Trial syllabi update" ON storage.objects FOR UPDATE USING (bucket_id = 'syllabi');
CREATE POLICY "Trial syllabi delete" ON storage.objects FOR DELETE USING (bucket_id = 'syllabi');
