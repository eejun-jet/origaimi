
ALTER TABLE public.marking_papers
  ADD COLUMN IF NOT EXISTS assessment_type text,
  ADD COLUMN IF NOT EXISTS variant_of uuid REFERENCES public.marking_papers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS points_setting numeric DEFAULT 0;

ALTER TABLE public.marking_deployments
  ADD COLUMN IF NOT EXISTS points numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_marking_papers_dept_subj_year
  ON public.marking_papers(department, subject, year);

CREATE OR REPLACE VIEW public.teacher_points_year AS
SELECT
  COALESCE(d.teacher_id::text, d.teacher_name) AS teacher_key,
  d.teacher_name,
  p.year,
  p.department,
  SUM(CASE WHEN d.role = 'setter'    THEN d.points ELSE 0 END) AS setting_points,
  SUM(CASE WHEN d.role = 'marker'    THEN d.points ELSE 0 END) AS marking_points,
  SUM(CASE WHEN d.role = 'moderator' THEN d.points ELSE 0 END) AS moderation_points,
  SUM(d.points) AS total_points
FROM public.marking_deployments d
JOIN public.marking_papers p ON p.id = d.paper_id
GROUP BY 1, 2, 3, 4;
