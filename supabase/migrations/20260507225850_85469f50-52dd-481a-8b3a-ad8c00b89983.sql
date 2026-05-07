
CREATE TABLE public.authentic_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text NOT NULL,
  subject text,
  level text,
  syllabus_doc_id uuid,
  sow_text text,
  sow_file_path text,
  unit_focus text,
  duration_weeks integer,
  class_size integer,
  goals text,
  constraints text,
  mix_preferences text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.authentic_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read" ON public.authentic_plans FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.authentic_plans FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.authentic_plans FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.authentic_plans FOR DELETE USING (true);

CREATE TRIGGER update_authentic_plans_updated_at
BEFORE UPDATE ON public.authentic_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.authentic_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.authentic_plans(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  mode text NOT NULL,
  title text NOT NULL,
  brief text,
  student_brief text,
  duration_minutes integer,
  group_size text,
  ao_codes text[] NOT NULL DEFAULT '{}',
  knowledge_outcomes text[] NOT NULL DEFAULT '{}',
  learning_outcomes text[] NOT NULL DEFAULT '{}',
  materials text[] NOT NULL DEFAULT '{}',
  rubric jsonb NOT NULL DEFAULT '[]'::jsonb,
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  teacher_notes text,
  status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX authentic_ideas_plan_id_idx ON public.authentic_ideas(plan_id);

ALTER TABLE public.authentic_ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trial open read" ON public.authentic_ideas FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.authentic_ideas FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.authentic_ideas FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.authentic_ideas FOR DELETE USING (true);

CREATE TRIGGER update_authentic_ideas_updated_at
BEFORE UPDATE ON public.authentic_ideas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
