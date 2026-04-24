-- Comments on assessments: paper-, section-, or question-scoped feedback from
-- authors, peer-setters, vetters, and clearance reviewers.

CREATE TABLE public.assessment_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('paper', 'section', 'question')),
  section_letter text,
  question_id uuid,
  parent_id uuid,
  author_name text NOT NULL,
  author_email text,
  author_role text NOT NULL DEFAULT 'other'
    CHECK (author_role IN ('author', 'peer_setter', 'vetter', 'clearance', 'other')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'addressed', 'resolved')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assessment_comments_assessment ON public.assessment_comments (assessment_id);
CREATE INDEX idx_assessment_comments_question   ON public.assessment_comments (question_id);
CREATE INDEX idx_assessment_comments_status     ON public.assessment_comments (status);
CREATE INDEX idx_assessment_comments_parent     ON public.assessment_comments (parent_id);

-- Touch updated_at on edits.
CREATE TRIGGER trg_assessment_comments_updated_at
  BEFORE UPDATE ON public.assessment_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.assessment_comments ENABLE ROW LEVEL SECURITY;

-- Trial-open policies (mirrors the rest of the schema). Tighten when real auth lands.
CREATE POLICY "Trial open read"   ON public.assessment_comments FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.assessment_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.assessment_comments FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.assessment_comments FOR DELETE USING (true);

-- Live updates so collaborators see new comments without refreshing.
ALTER TABLE public.assessment_comments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.assessment_comments;