## Macro Coverage: review a set of papers as one

Add a new page that lets a teacher group several already-parsed past papers (e.g. the four Combined Science papers) under one **Paper Set**, then runs the existing AO / KO / LO coverage analytics across the union of those papers' questions. Kept separate from the single-paper Assessment Coach so the UI stays uncluttered.

### User flow

1. From the dashboard or papers page, click **"Review a paper set"**.
2. Page 1 (set up) — like the assessment builder's first step:
   - Pick **Subject + Level** (drives the syllabus document the set is graded against).
   - Pick the **Syllabus document** (auto-selected when only one matches).
   - Name the set (e.g. "2025 Combined Science O-Level — full set").
   - Tick the past papers to include from a filtered list of already-parsed `past_papers` rows for that subject+level. Show parse status; only `ready` papers are selectable.
   - Save → creates a `paper_sets` row + `paper_set_papers` join rows.
3. Page 2 (coverage) — `/paper-set/$id`:
   - Header: set title, subject, level, syllabus, paper count, total questions, total marks (summed from `questions_json`).
   - **Cognitive demand** strip: AO mark-share aggregated across all papers vs declared syllabus weighting (delta bars, same component pattern as the assessment AO chart).
   - **KO / LO coverage** panel: same three views as the assessment page (By KO is default), but sourced from the union of question tags across the set. Each KO row shows which papers exercise it (badges "P1 ✓ P2 — P3 ✓ P4 ✓") so the gap is visible.
   - **Unrealised outcomes**: KOs / LOs in the syllabus that no question in the set touches.
   - **Per-paper contribution table**: rows = papers in the set; columns = % of marks per AO, # questions, # KOs covered. One glance shows which paper carries which load.
   - **Optional AI macro summary** (single button "Run macro review") — calls a new `paper-set-review` edge function that takes the aggregated stats + syllabus AO definitions and returns 2–4 calm one-liners about overall demand balance and any structural gaps. Mirrors `coach-review`'s voice rules (no praise, no verdicts). Persisted to `paper_set_reviews` so a re-run can be compared.

### Data model

New tables (migration):
- `paper_sets (id uuid pk, user_id uuid, title text, subject text, level text, syllabus_doc_id uuid → syllabus_documents.id, notes text, created_at, updated_at)`
- `paper_set_papers (set_id uuid → paper_sets.id on delete cascade, paper_id uuid → past_papers.id on delete cascade, position int, primary key(set_id, paper_id))`
- `paper_set_reviews (id uuid pk, set_id uuid → paper_sets, ran_at timestamptz, model text, snapshot jsonb)`

RLS: same "Trial open" policies as the existing tables in this project (the codebase is currently trial-mode; matches `assessments`, `past_papers`).

### Code touchpoints

- `src/routes/paper-set.new.tsx` — set-up page (subject/level/syllabus picker + paper-multi-select, similar styling to `papers.tsx` and `new.tsx` step 1).
- `src/routes/paper-set.$id.tsx` — coverage page. Heavy lifting reuses the AO / KO / LO mapping logic already in `src/routes/assessment.$id.tsx`. Extract the shared coverage-aggregation helpers into `src/lib/coverage.ts` so both pages call the same code (move `koLoGroups`, `normaliseLo`, AO mark-share calc, etc.).
- `src/routes/papers.tsx` — add a "Group into set" / "Review as set" entry point (multi-select checkboxes on the papers list, then a "Create set" button).
- `src/routes/dashboard.tsx` — surface existing paper sets (list with "Open coverage").
- `supabase/functions/paper-set-review/index.ts` — new edge function that receives the aggregated stats payload and calls Lovable AI Gateway (`google/gemini-2.5-flash`, same as `coach-review`) to produce the macro summary. Reuses the voice rules and output shape from `coach-review` but with a smaller schema (`summary`, `priority_insights`, `unrealised_outcomes`, `ao_drift`).
- No changes to the existing per-paper Assessment Coach.

### Why this is a separate page, not a tab in Assessment Coach

The current Coach is scoped to one `assessment` row (own questions, own blueprint, own mark scheme review). A paper set has no single blueprint, no mark-scheme rewrites, and no per-question suggestions — only aggregate coverage and demand balance. Folding that into the existing Coach UI confuses two different jobs, so it lives on its own route and only exposes the analytics that make sense at the macro level.

### Files touched

- New: `src/routes/paper-set.new.tsx`, `src/routes/paper-set.$id.tsx`, `src/lib/coverage.ts` (extracted), `supabase/functions/paper-set-review/index.ts`.
- Edited: `src/routes/papers.tsx` (multi-select + create-set entry), `src/routes/dashboard.tsx` (list paper sets), `src/routes/assessment.$id.tsx` (refactor to import from `src/lib/coverage.ts`).
- Migration: three new tables + RLS policies.
