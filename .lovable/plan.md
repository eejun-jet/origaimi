## Three small fixes

### 1. Sensible default `num_questions` when seeding Section A

`src/routes/new.tsx` lines 358–383 currently seed Section A with `num_questions = max(1, masterPool.length)`. With combined-science syllabi, the LO pool can run to ~100 entries, so a 40-mark paper opens with "97 questions" suggested.

Replace the seed with a format-aware default:

- If the seeded question type is **MCQ**: `num_questions = max(1, totalMarks)` (1 mark per question by convention).
- Otherwise: `num_questions = max(1, min(masterPool.length, ceil(totalMarks / 4)))` so structured-style sections start near the marks budget rather than the topic pool size.

The user can still override this from the section editor — we only change the *initial* value.

### 2. Coach: don't suggest re-marking MCQ unless the user said otherwise

`supabase/functions/coach-review/index.ts` (check 4, line 318) has the AI judge whether `marks_declared` matches cognitive demand for every question. For MCQ, the convention is **1 mark per question unless the teacher explicitly states otherwise**, so suggestions like "Q2 · 1m → 2m, Calculation mark scheme should specify method and final answer units" are noise.

Two changes inside that function:

a. Append a hard rule to the system prompt before the existing check 4 text:
```
MCQ items follow the convention "1 mark per question" unless the teacher's
instructions say otherwise. Do NOT propose mark-scheme changes for MCQ
questions (no marks_suggested entries, no method/units rewrites). Score MCQs
only on stem quality and answer correctness.
```

b. Filter `findings.mark_scheme_flags` and `findings.suggestions` server-side after parsing the tool call: drop any flag/suggestion whose target question is `question_type === "mcq"` and whose category is `marks` (or whose `marks_suggested` field is set). This is a belt-and-braces guard in case the model still slips one through.

### 3. Coach: don't recommend "diversify question types" on a single-format paper

When every question in the paper has the same `question_type` (e.g. a Paper-1 MCQ paper, or a structured-only paper), the `question_variety` finding telling the teacher to "explore including short answer questions or structured problem-solving tasks" is impossible to act on — the paper format is fixed.

Two changes:

a. Add a paper-format note to the system prompt above the variety check:
```
If the paper's section blueprint constrains every question to a single
question_type (e.g. an MCQ-only Paper 1, a structured-only Paper 2), the
question format is fixed by the syllabus. Do NOT recommend adding other
question types in question_variety. You may still observe command-verb,
context, or reading-load variation within the chosen format.
```

b. After parsing the tool call, compute `uniqueTypes = new Set(questions.map(q => q.question_type))`. If `uniqueTypes.size === 1`, drop `findings.question_variety` if it (i) mentions "multiple-choice", "short answer", "structured", "essay", or "diversif" / "include" / "introduce" of another format. Cheap regex on the `note` + `suggestion` is enough; we don't want to suppress legitimate within-format observations.

## Files touched

- `src/routes/new.tsx` — initial section-seed logic (~10 lines).
- `supabase/functions/coach-review/index.ts` — system prompt additions + post-parse filtering (~25 lines).

No DB / schema changes.
