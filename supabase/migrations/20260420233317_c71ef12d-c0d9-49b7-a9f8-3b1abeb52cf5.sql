-- Free-trial mode: allow anonymous (no-login) access across app data.
-- Replace per-user RLS with permissive policies so the anon key can read/write.
-- Data is shared across all trial visitors by design.

-- assessments
DROP POLICY IF EXISTS "Users view own assessments" ON public.assessments;
DROP POLICY IF EXISTS "Users insert own assessments" ON public.assessments;
DROP POLICY IF EXISTS "Users update own assessments" ON public.assessments;
DROP POLICY IF EXISTS "Users delete own assessments" ON public.assessments;
CREATE POLICY "Trial open read" ON public.assessments FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.assessments FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.assessments FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.assessments FOR DELETE USING (true);

-- assessment_questions
DROP POLICY IF EXISTS "Users view own questions" ON public.assessment_questions;
DROP POLICY IF EXISTS "Users insert own questions" ON public.assessment_questions;
DROP POLICY IF EXISTS "Users update own questions" ON public.assessment_questions;
DROP POLICY IF EXISTS "Users delete own questions" ON public.assessment_questions;
CREATE POLICY "Trial open read" ON public.assessment_questions FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.assessment_questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.assessment_questions FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.assessment_questions FOR DELETE USING (true);

-- assessment_versions
DROP POLICY IF EXISTS "Users view own versions" ON public.assessment_versions;
DROP POLICY IF EXISTS "Users insert own versions" ON public.assessment_versions;
CREATE POLICY "Trial open read" ON public.assessment_versions FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.assessment_versions FOR INSERT WITH CHECK (true);

-- question_bank_items
DROP POLICY IF EXISTS "Users view own bank" ON public.question_bank_items;
DROP POLICY IF EXISTS "Users insert own bank" ON public.question_bank_items;
DROP POLICY IF EXISTS "Users update own bank" ON public.question_bank_items;
DROP POLICY IF EXISTS "Users delete own bank" ON public.question_bank_items;
CREATE POLICY "Trial open read" ON public.question_bank_items FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.question_bank_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.question_bank_items FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.question_bank_items FOR DELETE USING (true);

-- reference_materials
DROP POLICY IF EXISTS "Users view own refs" ON public.reference_materials;
DROP POLICY IF EXISTS "Users insert own refs" ON public.reference_materials;
DROP POLICY IF EXISTS "Users update own refs" ON public.reference_materials;
DROP POLICY IF EXISTS "Users delete own refs" ON public.reference_materials;
CREATE POLICY "Trial open read" ON public.reference_materials FOR SELECT USING (true);
CREATE POLICY "Trial open insert" ON public.reference_materials FOR INSERT WITH CHECK (true);
CREATE POLICY "Trial open update" ON public.reference_materials FOR UPDATE USING (true);
CREATE POLICY "Trial open delete" ON public.reference_materials FOR DELETE USING (true);
