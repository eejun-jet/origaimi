ALTER TABLE public.syllabus_papers
  ADD COLUMN section text,
  ADD COLUMN track_tags text[] DEFAULT '{}'::text[],
  ADD COLUMN is_optional boolean NOT NULL DEFAULT false,
  ADD COLUMN assessment_mode text;

ALTER TABLE public.syllabus_topics
  ADD COLUMN section text;

CREATE INDEX idx_syllabus_topics_section ON public.syllabus_topics(section);
CREATE INDEX idx_syllabus_papers_section ON public.syllabus_papers(section);