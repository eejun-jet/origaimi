ALTER TABLE public.syllabus_topics
ADD COLUMN IF NOT EXISTS ko_content jsonb NOT NULL DEFAULT '{}'::jsonb;