## Diagnosis

You're right — easy / medium / hard regenerations look almost identical. Three concrete reasons in the code:

1. **Regeneration prompt anchors are too strong against difficulty.**
   `supabase/functions/regenerate-question/index.ts:99` tells the model: *"Keep its question_type, topic, **Bloom's level**, and marks."* Bloom's level (Remember / Apply / Analyse / Evaluate…) is the single biggest driver of cognitive demand. Locking it down means the rewrite stays at the same demand regardless of `easy / medium / hard`.

2. **The difficulty directive is one short, generic line.**
   `regenerate-question/index.ts:64` and `generate-assessment/index.ts:1036` both say variants of *"Calibrate stem complexity, distractor closeness, and required reasoning steps to match a typical MOE {level} item."* The model has no concrete rubric for what *easy* vs *hard* means — number of inference steps, vocabulary, novelty of context, distractor traps, scaffolding, data-extraction load, etc. Without anchors, the LLM defaults to a near-identical draft and just flips the `difficulty` field.

3. **`difficulty` is never compared against reality.**
   The model can return whatever it wants in the field; we don't audit whether the rewritten stem actually got harder/easier. So a hard-tagged question that "feels easy" passes through untouched.

## Plan

Make difficulty a real lever, not a label. Two surgical changes — no schema work, no UI churn.

### 1. Add a concrete difficulty rubric (shared)

New file `supabase/functions/_shared/difficulty.ts` exporting:

- `DIFFICULTY_RUBRIC` — a paragraph per level with **observable, calibratable criteria** for Singapore MOE papers, e.g.:
  - **easy:** single-step recall or direct application; familiar SG-textbook context; one piece of given data; MCQ distractors are clearly wrong on inspection; no multi-clause stems; vocabulary at level baseline.
  - **medium:** 2-step reasoning OR one transfer step into a familiar variant context; one extracted datum + one inference; MCQ distractors include one "almost right" trap from a common misconception; stem may have one qualifying clause.
  - **hard:** ≥3 reasoning steps OR transfer into an **unfamiliar context** OR multi-source synthesis; quantitative items require a non-obvious rearrangement / unit conversion / sig-fig discipline; MCQ distractors all encode named misconceptions; stem includes constraint(s) the candidate must notice; for SBQ, demands explicit weighing across provenance + content.
- `buildDifficultyDirective(target, subject, level)` — returns the full directive block to splice into prompts (uses the rubric above plus a checklist of "DO" / "DO NOT" lines so the model has explicit scaffolding to remove or add).

### 2. Rewire `regenerate-question`

`supabase/functions/regenerate-question/index.ts`:

- **Remove "Bloom's level" from the locked invariants** when `targetDifficulty` is supplied. New copy: *"Keep its question_type, topic, and marks. **Bloom's level may shift to match the target difficulty.**"* When no difficulty is supplied, behaviour is unchanged.
- **Replace** the one-line `difficultyDirective` with `buildDifficultyDirective(...)` — full rubric for the target level only, plus an explicit *"compared to the original stem, you MUST [add/remove] N of the following: …"* checklist so the rewrite is observably different.
- Keep the `difficulty: targetDifficulty ?? updated.difficulty` write-back as-is.

### 3. Rewire `generate-assessment` per-question targets

`supabase/functions/generate-assessment/index.ts` `difficultyBlock` (~line 1031):
- Replace the single calibration sentence with the same shared rubric, listed once at the top of the block, then the per-slot list. This makes per-question difficulty real instead of cosmetic.

### 4. Light client polish (optional, small)

`src/routes/assessment.$id.tsx:1665` — under "Target difficulty", show a one-line tooltip/help text summarising the rubric so teachers know what they're asking for. Pure copy, no logic.

## Files touched

- **new** `supabase/functions/_shared/difficulty.ts`
- `supabase/functions/regenerate-question/index.ts` (prompt edits only)
- `supabase/functions/generate-assessment/index.ts` (replace `difficultyBlock` body)
- `src/routes/assessment.$id.tsx` (one help line — optional)

## Why this will actually move the needle

The current prompt asks the model to keep Bloom + topic + marks fixed and then *whisper* "make it hard". The proposed prompt frees Bloom to move with difficulty, gives the model an explicit rubric of what hard *looks like* in MOE terms, and forces a comparative checklist against the original. That's the change that makes a regenerated "hard" item visibly harder rather than a cosmetic relabel.

No DB migration. No UI redesign. ~120 lines of edge-function changes.
