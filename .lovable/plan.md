# Assessment Coach — full v1 with all 7 checks

Replaces the "Coming soon" placeholder in the Coverage tab of `/assessment/$id` with a working Coach: a manual "Run Coach" button that fires a Lovable AI–powered review and renders structured findings inline.

## What ships

- A new edge function `coach-review` that runs all 7 checks in a single Lovable AI call (Gemini 2.5 Pro for accuracy on AO/command-word judgements) and returns structured findings via tool calling.
- Coach run history persisted in the existing `assessment_versions` table (label = `coach:<isoTimestamp>`, snapshot = findings + metadata). **No DB migration required** — the migration tool isn't available in this loop, and `assessment_versions` already has the right shape (`snapshot jsonb`, `label text`).
- A new `CoachPanel` component in `src/routes/assessment.$id.tsx` that replaces the placeholder card. Lists previous runs, lets the teacher run a new review, renders the 7 sections with severity badges, links findings to questions, and surfaces "Apply suggestion" buttons that write a rewrite back into `assessment_questions`.

## The 7 checks (model contract)

1. **AO drift** — for each declared AO, compare syllabus weighting % against actual mark share of questions tagged with it. `warn` if delta > 8 pp, `fail` if > 15 pp.
2. **Command-word audit** — extract leading verb of each stem; judge whether it matches the declared AO. History/Humanities uses MOE AO3 verbs (infer/compare/how-similar/how-far/evaluate); Sciences uses AO1=recall, AO2=apply, AO3=analyse.
3. **KO/LO realisation** — list every KO and LO ticked at paper or section level that no question actually exercises.
4. **Bloom & difficulty curve** — per section, flag clustering or anti-progression (hard before easy).
5. **Source-question fit** — humanities only. Judges whether each SBQ's source actually supports the demanded skill (purpose ↔ authorship; compare ↔ two contrasting sources; infer ↔ implicit content).
6. **Mark-scheme realism** — flag when declared marks differ from suggested marks by ≥ 1 given cognitive demand and command word.
7. **Suggestions** — for every fail/warn, ONE one-line "Try: …" rewrite, same question type, ±1 mark of original.

Returned strictly via a tool with a typed schema so we render deterministically.

## UX in the Coverage tab

```text
┌─ Assessment Coach ─────────────────┐
│ Run Coach   ▼ Last run: 2 min ago  │
│ 12 findings (3 fail · 5 warn · 4 info)
├────────────────────────────────────┤
│ Summary: ……                        │
│ ▸ AO drift             2 findings  │
│ ▸ Command words        3 findings  │
│ ▸ Unrealised KO/LO     ……          │
│ ▸ Bloom curve          1 finding   │
│ ▸ Source fit           2 findings  │
│ ▸ Mark scheme          ……          │
│ ▸ Suggestions          5 rewrites  │
└────────────────────────────────────┘
```

Each finding is collapsible and links to its question (smooth-scroll to the question card on the left). "Apply suggestion" updates `assessment_questions.stem` for that question and re-records the run. "Dismiss" hides the finding for the current view (no DB write — re-running Coach starts fresh).

## Decisions baked in (per the questions I would have asked)

- **Scope**: all 7 checks (user requested "run all 7").
- **Trigger**: manual "Run Coach" button — auto-running on every open would burn AI credits and confuse iteration.
- **Persistence**: yes, every run stored in `assessment_versions` so teachers can compare runs after edits. A history dropdown in the panel lets them switch between runs.

## Technical notes

- **Files**:
  - `supabase/functions/coach-review/index.ts` (new) — the edge function.
  - `src/routes/assessment.$id.tsx` — replace the "Coming soon" card (lines 813–824) with `<CoachPanel/>`. Add the panel component, the run-coach call (`supabase.functions.invoke('coach-review', { body: { assessmentId } })`), and the apply-suggestion mutation. Load the latest stored run on mount via a `select * from assessment_versions where assessment_id=… and label like 'coach:%' order by created_at desc limit 10`.
- **Model**: `google/gemini-2.5-pro` — Pro because the AO/command-word judgement is the hard part. Falls back gracefully on 429/402 with surfaced toasts.
- **Token budget**: stems clipped to 1,200 chars and mark schemes to 600 chars before being sent to the model — keeps a 50-question paper well under the context limit.
- **Storage shape**: `assessment_versions.snapshot = { kind: "coach_review", model, ran_at, total_actual_marks, total_marks, findings: { …7 sections… } }`. We use `label = "coach:<iso>"` to namespace these from teacher-saved versions.
- **Errors**: 429 → "Rate limit reached. Try again in a minute." 402 → "AI credits exhausted." Other → "Coach is temporarily unavailable."

## Out of scope (for v1)

- No auto-running on open.
- No multi-run diff view (the runs are stored, but the diff UI is a v2 add).
- No batching across multiple papers.
- No teacher-overrideable severity thresholds — fixed in the prompt for now.
