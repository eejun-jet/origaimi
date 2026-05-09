-- Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('teacher','hod','sl','admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  department text,
  school text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, department, school)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.user_roles FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.user_roles FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.user_roles FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.user_roles FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Profile additions
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;

-- Teacher aliases (CSV-name resolution)
CREATE TABLE IF NOT EXISTS public.teacher_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alias)
);
ALTER TABLE public.teacher_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.teacher_aliases FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.teacher_aliases FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.teacher_aliases FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.teacher_aliases FOR DELETE USING (true);

-- Marking papers
CREATE TABLE IF NOT EXISTS public.marking_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid,
  title text NOT NULL,
  subject text,
  level text,
  stream text,
  duration_minutes integer,
  department text,
  school text,
  remarks text,
  semester text,
  year integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marking_papers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.marking_papers FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.marking_papers FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.marking_papers FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.marking_papers FOR DELETE USING (true);
CREATE TRIGGER trg_marking_papers_updated BEFORE UPDATE ON public.marking_papers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Marking deployments (one row per teacher x class)
CREATE TABLE IF NOT EXISTS public.marking_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.marking_papers(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('setter','marker')),
  teacher_id uuid,
  teacher_name text,
  class_label text,
  script_count integer NOT NULL DEFAULT 0,
  marked_count integer NOT NULL DEFAULT 0,
  flagged_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','marking_done','moderated')),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_md_paper ON public.marking_deployments(paper_id);
CREATE INDEX IF NOT EXISTS idx_md_teacher ON public.marking_deployments(teacher_id);
ALTER TABLE public.marking_deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.marking_deployments FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.marking_deployments FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.marking_deployments FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.marking_deployments FOR DELETE USING (true);
CREATE TRIGGER trg_marking_deployments_updated BEFORE UPDATE ON public.marking_deployments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Optional per-script rows
CREATE TABLE IF NOT EXISTS public.marking_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.marking_deployments(id) ON DELETE CASCADE,
  student_ref text,
  marks_awarded integer,
  flagged boolean NOT NULL DEFAULT false,
  flag_reason text,
  marked_at timestamptz,
  moderated_at timestamptz,
  moderator_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marking_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.marking_scripts FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.marking_scripts FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.marking_scripts FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.marking_scripts FOR DELETE USING (true);

-- Import log
CREATE TABLE IF NOT EXISTS public.marking_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  filename text,
  department text,
  semester text,
  year integer,
  rows_parsed integer NOT NULL DEFAULT 0,
  papers_created integer NOT NULL DEFAULT 0,
  deployments_created integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  unmatched_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marking_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trial open read" ON public.marking_imports FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.marking_imports FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.marking_imports FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.marking_imports FOR DELETE USING (true);