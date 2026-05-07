## What we're adding

A new mode alongside the existing "written paper" builder: an **Authentic Assessment Studio**. The teacher uploads (or pastes) a *Scheme of Work* — i.e. what they're teaching this term/unit — and origAImi proposes a balanced **portfolio** of assessment ideas beyond formal exams:

- **Mini-tests / quizzes** (10–20 min checks for understanding)
- **Performance tasks** in authentic contexts (lab investigation, fieldwork write-up, design challenge, data analysis brief)
- **Project work** (multi-lesson, often group, with milestones + rubric)
- **Oral / presentation** tasks (pitch, viva, debate, gallery walk)
- **Written authentic** tasks (letter to MP, op-ed, source-based memo)
- **Self / peer assessment** moments

Each idea comes with: title, mode, duration, group size, AO/KO/LO it evidences, materials needed, a teacher-facing rubric stub, and a one-paragraph student brief. Teacher can save selected ideas into a new **Assessment Plan** for the unit.

## Where it lives

New top-level route `/authentic` (entry from dashboard, beside "New paper" and "New paper set"):
- `src/routes/authentic.new.tsx` — upload SoW + pick subject/level/syllabus, configure portfolio shape
- `src/routes/authentic.$id.tsx` — generated portfolio: tiles of ideas, filter by mode/AO/KO, save / regenerate / refine, export DOCX
- Optional later: `src/routes/authentic.index.tsx` listing saved plans

Reuses existing patterns: `BuilderUploadCard`, `PlainSelect`, `AppHeader`, syllabus picker (`loadSyllabusLibrary`, `loadDocTopics`, `loadDocAssessmentObjectives`).

## Data model (one migration)

Two new tables, public RLS open like the rest of the project:

```text
authentic_plans
  id uuid pk, user_id uuid, title text, subject text, level text,
  syllabus_doc_id uuid, sow_text text, sow_file_path text,
  unit_focus text, duration_weeks int, class_size int,
  goals text, constraints text,
  created_at, updated_at

authentic_ideas
  id uuid pk, plan_id uuid, position int,
  mode text  -- mini_test | performance_task | project | oral | written_authentic | self_peer
  title text, brief text, duration_minutes int, group_size text,
  ao_codes text[], knowledge_outcomes text[], learning_outcomes text[],
  materials text[], rubric jsonb,    -- [{criterion, levels:[{label,descriptor}]}]
  teacher_notes text, status text default 'suggested',  -- suggested|saved|rejected
  created_at, updated_at
```

Storage bucket: reuse `references` for SoW uploads.

## Generation pipeline

New edge / server function `generate-authentic-ideas`:

Inputs: `{ plan_id }`. Loads plan + syllabus context (AOs from `syllabus_assessment_objectives`, KOs/LOs from `syllabus_topics` filtered to the unit), parses SoW (PDF/DOCX via existing `parse-syllabus`-style pdf parsing, or accept pasted text first to ship faster).

Calls Lovable AI (`google/gemini-2.5-pro`) with a structured tool-call schema returning `{ ideas: [...] }`. System prompt is a Singapore-MOE assessment-design coach: emphasise validity (does the task evidence the stated AO/LO?), authenticity (Singapore-relevant context), feasibility (time, class size, materials), and balance across the six modes. Returns 8–12 ideas covering different modes and outcomes.

The function writes ideas into `authentic_ideas`. Client streams the generation status and renders tiles as they save.

A second function `refine-authentic-idea` accepts `{ idea_id, instruction }` (e.g. "make this group of 4", "lower the difficulty", "add a digital tool", "shorten to one lesson") and rewrites the single idea in place.

## UX flow

1. **Upload step** (`/authentic/new`): subject + level + syllabus picker (reuse existing); choose unit focus (free text or KO/LO multi-select from the syllabus); upload SoW PDF/DOCX OR paste SoW text; sliders for *duration weeks*, *class size*; portfolio mix preference (chips: "balanced", "more authentic", "more formative", "no group work", etc.); optional constraints box ("no out-of-school trips", "must include ICT").

2. **Generation** → creates plan row, navigates to `/authentic/$id`, kicks off `generate-authentic-ideas`. Skeleton tiles fill in as ideas arrive.

3. **Portfolio view** (`/authentic/$id`):
   - Header: unit title, AO coverage bar (tag-driven), mode mix donut.
   - Filter chips: All / Mini-test / Performance / Project / Oral / Written / Self-peer; AO filter; "Saved only".
   - Tile per idea: mode pill, title, 1-line brief, duration · group size · AO/KO chips, "View detail" / "Save" / "Regenerate" / "Reject".
   - Detail drawer: full student brief, materials, rubric table, teacher notes, edit button → opens refine prompt.
   - Bottom action: **Export plan** (DOCX of all saved ideas, reuse `export-docx` patterns) and **Add to Paper Set** (for ideas that became mini-tests, hand off to existing `paper-set.new`).

4. **Iteration**: "Regenerate with this twist" textarea at top of portfolio re-runs generation honouring previously saved ideas (locked) and replacing only un-saved ones.

## Coach integration

Reuse `coach-intent` philosophy: silent-by-default deterministic checks before generation —
- AO weighting too narrow (e.g. 100% recall),
- only one mode chosen,
- duration vs class size mismatch (e.g. 40 students × 30-min oral in 1 lesson),
- "no group work" + "presentation" conflict.
Surface as the same amber chips already used in the paper builder.

## Out of scope (this round)

- Full LMS-style student submission / grading — we stop at idea + rubric.
- AI auto-marking of student work.
- Sharing plans between teachers (later, piggy-backs on existing comments table pattern).

## Files to add / touch

- DB migration: two tables above.
- `supabase/functions/generate-authentic-ideas/index.ts`
- `supabase/functions/refine-authentic-idea/index.ts`
- `src/lib/authentic.ts` — types + client helpers (`createPlan`, `listIdeas`, `saveIdea`, etc.)
- `src/lib/authentic-coach.ts` — deterministic pre-generation checks (mirrors `intent-coach.ts`).
- `src/routes/authentic.new.tsx`
- `src/routes/authentic.$id.tsx`
- `src/components/AuthenticIdeaTile.tsx`, `AuthenticIdeaDetailDrawer.tsx`, `AuthenticRubricTable.tsx`
- `src/lib/export-authentic-docx.ts` (reuse helpers from `export-docx.ts`)
- `src/routes/dashboard.tsx` — add "New authentic assessment plan" CTA.
- `src/routes/index.tsx` — short marketing blurb so the homepage reflects the broader scope.

## Result

The teacher uploads "Sec 3 Chemistry — Term 2 SoW (Acids, Bases & Salts)", hits generate, and gets 10 tiles ranging from a 15-min titration mini-quiz, to a "design a low-cost antacid" performance task with rubric, to a 3-week group project producing a public-information video on water hardness in Singapore — each tagged to AO1/AO2/AO3 and the right LOs from 5086. They tick the four they like, export as DOCX, and the mini-quiz hands off to the existing paper-set flow for AI generation of the actual quiz.

Approve and I'll implement in two passes: (1) DB + new/$id routes + generation function with pasted-text SoW; (2) PDF/DOCX SoW parsing + refine flow + DOCX export.