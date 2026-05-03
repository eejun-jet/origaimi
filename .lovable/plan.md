# Skills Outcomes for Social Studies (document-level, cross-cutting)

## Model

- **4 SOs live once** on the SS `syllabus_documents` row and apply to every Issue / sub-issue / question in that syllabus.
- **Issues + sub-issues** stay as `syllabus_topics` (unchanged).
- **Indicative content** stays in `ko_content` per topic (already shipped).
- **`learning_outcomes`** column on SS topics goes unused — SS questions are tagged with `{topic, KOs, AOs, SO codes}` instead of LOs.

Coverage question becomes: *"Across the whole paper, did we exercise SO1–SO4 enough times?"* — not per-Issue, not per-question-mandatory.

## Schema

One additive column:

```sql
ALTER TABLE syllabus_documents
  ADD COLUMN skills_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Shape: `[{ "code": "SO1", "statement": "examine societal issues critically..." }, ...]`. Populated on the SS doc only; empty/ignored everywhere else.

No change to `syllabus_topics`. No per-Issue SO storage.

## Ingestion from your .xlsx

One-off script (`scripts-tmp/ingest_ss_skills.mjs`):
1. Read 4 rows of `code | statement`.
2. Write the array to `skills_outcomes` on the SS `syllabus_documents` row (looked up by `syllabus_code` or doc id you confirm).

Idempotent — replaces the array.

## UI changes (SS-only branches; non-SS unchanged)

### `admin.syllabus.$id.tsx`
- Add a top-of-page **"Skills Outcomes"** card (visible only when subject is SS): editable list of `{code, statement}`. Persists to `syllabus_documents.skills_outcomes`.
- Topic editor: hide the LO editor for SS topics; keep KO + `ko_content` editors as today.

### `new.tsx` (Assessment Builder)
- For SS papers, render an **"SO targets"** panel listing the 4 SOs with a per-SO target count (default e.g. 1–2 questions each). Stored on `assessments.blueprint`.
- Non-SS unchanged.

### `assessment.$id.tsx` (Coverage)
- For SS, replace "LO Coverage" with **"Skills Outcome Coverage"**: a 4-row bar showing `hits vs target` per SO, with the existing under/well/over colour grammar.
- Non-SS unchanged.

## Generator + coach

### `generate-assessment/index.ts`
- For SS: inject the 4 SOs and their per-SO targets as **paper-level skill targets** in the prompt. Instruct the model to tag each generated question with the SO code(s) it exercises (multi-tag allowed). Per-Q LO tagging is dropped for SS.
- Persist `so_codes` on `assessment_questions` — use the existing `learning_outcomes` text array as the storage column to avoid a schema change (semantically: "outcomes the question hits"; for SS these are SO codes, for other subjects LO codes — same column, different vocabulary). Document this in the function header.

### `coverage-infer.ts` (×3 copies — `src/lib/`, `supabase/functions/coach-review/`, `supabase/functions/generate-assessment/`)
- Add `inferSOs(text, soPool)` keyed off SS verb cues:
  - "infer / from the source / how useful / how reliable / surprised" → source-handling SO
  - "to what extent / weighing / judgement" → reasoned-argument SO
  - "compare / contrast / similar / different" → comparison SO
  - "appreciate / multiple perspectives / different views" → perspectives SO
- The cue→SO mapping is built from the SO `statement` tokens at runtime so it adapts to whatever the .xlsx defines (no hardcoded statement text).

### `coach-review/index.ts` + `paper-set-review/index.ts`
- Pass the 4 SOs + targets into the coach payload. Coach reports paper-level SO engagement and flags under/over-tested SOs only — no per-Q LO overtesting flags for SS.

## Migration / rollout

1. Schema migration: add `skills_outcomes` column.
2. You upload .xlsx → I run ingest → verify in admin editor.
3. UI + generator + coach branches gated behind `subject === "Social Studies"` (or the SS syllabus doc's subject) so Sci/Hist are untouched.

## What I need from you

- The .xlsx with the 4 SOs (`code | statement`).
- Confirm which `syllabus_documents` row is the SS doc to bind to (title or syllabus_code), so the ingest script targets it precisely.
