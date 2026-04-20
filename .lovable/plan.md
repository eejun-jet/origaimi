
# Joy of Assessment — MVP Plan

A blueprint-first AI assessment platform for Singapore teachers (Primary + Secondary, all core subjects) that turns hours of manual paper-setting into minutes of expert refinement.

## Core experience

**1. Teacher onboarding & accounts**
- Email/password sign-up via Lovable Cloud auth
- Profile: name, school (free text), subjects taught, levels taught
- Personal workspace — assessments, question bank, uploaded references all private to the teacher

**2. Assessment dashboard ("My Assessments")**
- Grid of draft / in-review / finalised assessments with status, subject, level, last edited
- Filters by subject, level, status; search by title
- Primary CTA: **"Create new assessment"**

**3. Blueprint-first creation flow**
The signature workflow. Teacher defines the assessment specification *before* AI generates anything.

- **Step 1 — Basics**: title, subject (Math, Science, English, Mother Tongue, Humanities), level (P1–Sec 4), assessment type (formative quiz, topical test, mid-year, prelim, mock paper), total duration, total marks
- **Step 2 — Topics**: pick from MOE syllabus topic tree for the chosen subject + level (curated for MVP — start with Math P1–P6, Sec E-Math, Sec Science, English Comprehension; expand iteratively)
- **Step 3 — Blueprint table**: editable matrix of **Topic × Bloom's level (Remember / Understand / Apply / Analyse / Evaluate / Create) × Marks**. Auto-suggested distribution; teacher tweaks. Live total-marks check.
- **Step 4 — Question types & sources**: pick mix of MCQ, Short Answer, Structured, Long/Essay, Comprehension, Practical, Source-Based. Choose item sources: AI-generate / pull from my Question Bank / adapt from uploaded references.
- **Step 5 — References (optional)**: upload past papers, worksheets, or textbook pages (PDF/DOCX/images). AI extracts style, difficulty, and item patterns to mimic.
- **Step 6 — Generate**: AI drafts the full assessment matching the blueprint exactly.

**4. The Assessment Architect editor**
Where teachers add their pedagogical expertise.
- Side-by-side: question list ↔ live preview of the paper
- Per-question controls: **inline edit**, **regenerate** (with optional instruction like "make harder" / "use a Singapore context"), **swap from question bank**, **delete**, **reorder**
- Difficulty + Bloom's level tag on every question; teacher can override
- **Mark scheme panel**: AI-generated marking rubric and model answers per question, also editable
- **Blueprint compliance meter**: visual indicator showing if current questions still match the blueprint (e.g. "Apply-level questions: 8/10 marks ✓")
- **Version history**: every save creates a snapshot; restore any previous version
- **Comments / notes** on individual questions for personal review

**5. Question Bank**
- Personal library of approved/reusable items
- Add to bank from any assessment with one click
- Tag by topic, level, Bloom's, difficulty, type, source (AI / mine / from upload)
- Search + filter; insert into any assessment via the editor's "swap" action

**6. Reference library**
- All uploaded past papers / worksheets stored per teacher
- Reusable across future assessments
- AI parses and indexes them once on upload

**7. Export & share**
- Export student paper (PDF + DOCX)
- Export mark scheme (separate PDF + DOCX)
- Print-ready layout with school header field, instructions, marks per question, answer spaces

## AI behaviour
- All generation goes through Lovable AI Gateway (Gemini 3 Flash Preview default; Gemini 2.5 Pro for complex generation like full-paper drafts and Source-Based questions)
- Server functions only — prompts and syllabus context kept on backend
- Singapore syllabus context (MOE-style phrasing, local examples, SI units, British spelling) baked into system prompts per subject
- Structured tool-calling output for reliable question schemas (stem, options, answer, working, marks, Bloom's, difficulty)

## Tech & data
- TanStack Start + Lovable Cloud (Postgres + Auth + Storage)
- Tables: `profiles`, `assessments`, `assessment_questions`, `question_bank_items`, `reference_materials`, `assessment_versions`
- RLS: every row scoped to `auth.uid()` — teachers see only their own data
- Storage buckets: `references` (private), `exports` (private)
- Server functions for: generate-blueprint-suggestion, generate-assessment, regenerate-question, generate-mark-scheme, parse-reference-upload, export-pdf, export-docx

## Design direction
Clean, calm, professional — closer to Notion/Linear than a flashy edtech app. Generous whitespace, MOE-friendly serif for question previews, sans for UI. Soft blues + warm neutrals. Mobile-aware but desktop-first (teachers work on laptops).

## Out of scope for MVP (note for later)
- School/department workspaces & sharing
- Auto-grading of student responses
- LMS integrations (SLS, Google Classroom)
- Analytics on student performance
- Multi-language UI (English-only MVP; Mother Tongue subjects come in v2)
