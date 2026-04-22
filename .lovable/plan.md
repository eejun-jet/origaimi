

## Goal
Let teachers control the **difficulty mix** of a Science paper at generation time (proportion of easy / medium / hard), and let them **regenerate any question at a chosen difficulty** afterwards.

## What's there today
- Sections (in `src/lib/sections.ts`) carry `question_type`, `marks`, `num_questions`, `bloom`, `topic_pool` — but **no difficulty target**. The AI picks `difficulty` per question freely (`easy | medium | hard`).
- The single-question regenerator (`supabase/functions/regenerate-question/index.ts`) only accepts a freeform `instruction`. The bulk regenerate dialog in `src/routes/assessment.$id.tsx` is the same.
- Difficulty is already stored on every `assessment_questions` row, so we can read & display it.

## Plan

### 1. Section model — add a difficulty mix
- **`src/lib/sections.ts`**: extend `Section` with an optional `difficulty_mix?: { easy: number; medium: number; hard: number }` (percentages summing to 100). `defaultSection` returns `{ easy: 20, medium: 60, hard: 20 }` — a sensible MOE-style default.
- Mix is **optional** so existing assessments keep working.

### 2. Builder UI — only for Science
- **`src/routes/new.tsx`** in the section card (around line 1185, under the Bloom / # Questions / Marks row): if the chosen subject is Physics / Chemistry / Biology / General Science / Combined Science, render a "Difficulty mix" block:

  ```text
  Difficulty mix      Easy  [ 20 %]   Medium [ 60 %]   Hard [ 20 %]
                      ─────────────────────────────────  total 100%
  ```

  - Three small number inputs (0–100) with a live total + colored warning if ≠ 100.
  - A "Reset to default" link (20 / 60 / 20).
  - For non-science subjects we hide the block entirely (no behaviour change).
- Validation on the "Generate" step blocks submission if any science section's mix doesn't sum to 100.

### 3. Generator — convert mix to per-question targets
- **`supabase/functions/generate-assessment/index.ts`**:
  - Add `assignDifficultyToQuestions(mix, n)` — deterministically maps a percentage mix to an array of `n` labels (e.g. mix 20/60/20 with n=5 → `["easy","medium","medium","medium","hard"]`). Uses largest-remainder rounding so totals always match `n`.
  - In `buildUserPrompt` (around lines 424–450), if `section.difficulty_mix` is set, append a "DIFFICULTY DISTRIBUTION" block that lists the target difficulty for each question slot (Q1=easy, Q2=medium…) and instructs the model to honour it.
  - When inserting questions (around line 855–870), overwrite `difficulty` with the planned target if it differs from what the model returned, so the saved row matches the teacher's plan exactly.
- Non-science / no-mix sections behave exactly as today.

### 4. Per-question regenerate at a chosen difficulty
- **`supabase/functions/regenerate-question/index.ts`**:
  - Accept an optional `difficulty: "easy" | "medium" | "hard"` in the request body.
  - When provided, inject "Target difficulty: <level>. Calibrate stem complexity, distractor closeness, and required reasoning steps to match a typical MOE <level> item." into the user prompt, and force the tool's returned `difficulty` to that value before saving.
- **`src/routes/assessment.$id.tsx`**:
  - In `QuestionCard`'s regenerate panel, add a small `Select` ("Difficulty: keep / easy / medium / hard"). Pass it into `onRegenerate(instruction, difficulty)`.
  - Update `regenerate(qId, instruction, difficulty)` to forward the field to the edge function.
  - Same dropdown in the bulk regenerate dialog so teachers can re-level several questions in one action.
  - Show the current `q.difficulty` as a badge next to the existing Bloom badge so teachers can see what they're changing.

### 5. No DB migration
`assessment_questions.difficulty` already exists. The mix lives in `assessments.blueprint` JSON, so no schema change.

## Files touched
```
src/lib/sections.ts                                       difficulty_mix on Section
src/routes/new.tsx                                        mix UI per section (science only) + validation
src/routes/assessment.$id.tsx                             difficulty selector in regen panels + badge
supabase/functions/generate-assessment/index.ts           plan & enforce per-question difficulty
supabase/functions/regenerate-question/index.ts           accept & honour target difficulty
```

## Result
- When generating a Science paper, teachers set e.g. 30 / 50 / 20 and the paper comes back with that exact distribution per section.
- Any question can be re-rolled at a specific target difficulty from its card or from the bulk regenerate dialog.
- Other subjects are unaffected.

