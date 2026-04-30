
## Short answer

Yes — and most of the pipeline already exists. Today, when a user uploads a past paper on the Papers page, `parse-paper` extracts every question with marks, command word, sub-parts, attached diagrams, then classifies each one against the matching syllabus to assign **topic, learning outcomes, knowledge outcomes, AO codes, and Bloom level**. It also writes a difficulty fingerprint to the paper.

What's missing is the **last-mile UI**: a single "Analyse this paper" action that turns those parsed questions into the same shape the rest of the app understands (an assessment with `assessment_questions`), so the Table of Specifications view, AO/KO/LO map, and Assessment Coach all work on it.

## What the user will see

On the Papers page, each parsed paper gets a new **"Analyse paper"** button (next to the existing exemplar-ready badge). Clicking it:

1. Creates an assessment from the parsed paper (subject, level, total marks, duration inferred from syllabus paper if matched).
2. Imports each parsed question into `assessment_questions` with its stem, marks, command word, AOs, KOs, LOs, topic, and Bloom level.
3. Routes the user to `/assessment/$id`, which already renders:
   - **Table of Specifications** — marks × topic × Bloom/AO grid (existing component on the assessment page).
   - **AO / KO / LO coverage** — already computed per-question and shown in the assessment view.
   - **Assessment Coach** — the user clicks "Run Coach" as usual; the existing calibration step compares the paper against specimen fingerprints.

A second button, **"Send to bank"**, additionally writes each parsed question into `question_bank_items` so they become reusable exemplars (subject, level, topic, AOs, KOs, LOs, command word, marks, source year/paper, source excerpt, diagram paths).

## Technical changes

### 1. New server function: `analysePastPaper`

`src/server/papers.functions.ts` (new) — authenticated `createServerFn` that takes `paperId`, reads `past_papers` + classified `questions_json`, and:

- Inserts a row into `assessments` with:
  - `title`: `"Analysis · " + paper.title`
  - `subject`, `level` from the paper
  - `assessment_type`: `"past_paper_analysis"` (new value, no enum to update)
  - `total_marks`: sum of question marks
  - `duration_minutes`: from matched `syllabus_papers.duration_minutes` if available, else null
  - `syllabus_doc_id` / `syllabus_paper_id`: matched on subject+level+paper_number when possible
  - `status`: `"draft"`
- Inserts one `assessment_questions` row per parsed question with `stem`, `marks`, `question_type`, `topic`, `bloom_level`, `ao_codes`, `learning_outcomes`, `knowledge_outcomes`, `source_excerpt`, `diagram_url` (mapped from `past_paper_diagrams`), `notes` carrying the original question number/sub-parts.
- Returns `{ assessmentId }`.

A second function `importPaperToBank` writes each question into `question_bank_items` with `source: "past_paper"`, `past_paper_id`, `question_number`, `year`, `paper_number`, `exam_board`, plus the same AO/KO/LO/topic fields and any `diagram_paths`.

Both functions use `requireSupabaseAuth` and respect RLS.

### 2. Papers page UI (`src/routes/papers.tsx`)

For each paper where `parse_status = "ready"` and `questions_json` is non-empty:

- Add an **"Analyse paper"** primary button → calls `analysePastPaper` → toast on success → `navigate({ to: "/assessment/$id", params: { id } })`.
- Add a **"Send to bank"** secondary button → calls `importPaperToBank` → toast with count.
- Disable both while parsing is pending; show spinner during the call.

### 3. Assessment view tweaks (`src/routes/assessment.$id.tsx`)

The existing TOS, AO/KO/LO coverage, and Coach panels already key off `assessment_questions`, so they "just work" for analysed papers. Two small touches:

- When `assessment_type === "past_paper_analysis"`, show a header chip "From past paper · {paper.title}" linking back to `/papers`.
- Hide the "Generate questions" / "Regenerate" actions in this mode (the questions came from a real paper — no AI generation step needed).
- Coach behaves normally: it loads the questions, runs the rubric, and runs the calibration step against the specimen fingerprint for that subject+level. For an analysed paper, this answers "how does this real paper score against our standards?".

### 4. Coach prompt note

`coach-review` already reads any assessment regardless of how it was created, so no functional change is needed. Add one sentence to its system prompt: when `assessment_type === "past_paper_analysis"`, frame findings as a critique of the existing paper rather than suggested edits, and skip "rewrite the stem" type recommendations.

### 5. Schema

No migration required. Reuses existing tables and columns:
- `assessments`, `assessment_questions` (already populated by the generator)
- `past_papers.questions_json` (already populated by `parse-paper` with classifications)
- `past_paper_diagrams` (already linked to questions)
- `question_bank_items` already supports `source = "past_paper"` and `past_paper_id`.

### 6. Edge cases

- **Paper not yet parsed / no syllabus match**: button disabled with tooltip "Parse paper first" or "No matching syllabus uploaded — AO/KO/LO will be empty". The analysis still runs; the TOS shows marks/topic/Bloom but AO columns will be sparse.
- **Sub-parts**: each (a)(b)(i)(ii) becomes its own `assessment_questions` row, marks summed correctly, position preserved.
- **Diagrams**: the first diagram referenced by the question is wired into `diagram_url` for the assessment question; bank import keeps the full `diagram_paths` array.
- **Idempotency**: re-running "Analyse paper" creates a new assessment each time (cheap, lets the user compare runs); we surface the most recent one on the Papers card.

## Files to add or edit

- `src/server/papers.functions.ts` (new) — `analysePastPaper`, `importPaperToBank`
- `src/routes/papers.tsx` — add the two buttons and call sites
- `src/routes/assessment.$id.tsx` — header chip + hide generation actions for `past_paper_analysis`
- `supabase/functions/coach-review/index.ts` — one-paragraph prompt addition for analysis mode
