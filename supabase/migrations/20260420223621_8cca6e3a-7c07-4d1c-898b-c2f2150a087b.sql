-- Profiles table for teacher info
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  school TEXT,
  subjects TEXT[] DEFAULT '{}',
  levels TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE TABLE public.assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  level TEXT NOT NULL,
  assessment_type TEXT NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  total_marks INT NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'draft',
  topics JSONB DEFAULT '[]',
  blueprint JSONB DEFAULT '[]',
  question_types JSONB DEFAULT '[]',
  item_sources JSONB DEFAULT '[]',
  instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own assessments" ON public.assessments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own assessments" ON public.assessments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own assessments" ON public.assessments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own assessments" ON public.assessments
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.assessment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  question_type TEXT NOT NULL,
  topic TEXT,
  bloom_level TEXT,
  difficulty TEXT,
  marks INT NOT NULL DEFAULT 1,
  stem TEXT NOT NULL,
  options JSONB,
  answer TEXT,
  working TEXT,
  mark_scheme TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own questions" ON public.assessment_questions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own questions" ON public.assessment_questions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own questions" ON public.assessment_questions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own questions" ON public.assessment_questions
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_questions_assessment ON public.assessment_questions(assessment_id, position);

CREATE TABLE public.question_bank_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  level TEXT NOT NULL,
  topic TEXT,
  bloom_level TEXT,
  difficulty TEXT,
  question_type TEXT NOT NULL,
  marks INT NOT NULL DEFAULT 1,
  stem TEXT NOT NULL,
  options JSONB,
  answer TEXT,
  mark_scheme TEXT,
  source TEXT DEFAULT 'mine',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.question_bank_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own bank" ON public.question_bank_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bank" ON public.question_bank_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own bank" ON public.question_bank_items
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own bank" ON public.question_bank_items
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.reference_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  level TEXT,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  parsed_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reference_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own refs" ON public.reference_materials
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own refs" ON public.reference_materials
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own refs" ON public.reference_materials
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own refs" ON public.reference_materials
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.assessment_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assessment_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own versions" ON public.assessment_versions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own versions" ON public.assessment_versions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public) VALUES ('references', 'references', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('exports', 'exports', false);

CREATE POLICY "Users read own references" ON storage.objects
  FOR SELECT USING (bucket_id = 'references' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own references" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'references' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own references" ON storage.objects
  FOR DELETE USING (bucket_id = 'references' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own exports" ON storage.objects
  FOR SELECT USING (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own exports" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'exports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_assessments_updated BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON public.assessment_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bank_updated BEFORE UPDATE ON public.question_bank_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();