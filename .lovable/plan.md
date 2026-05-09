## Issue 1 — "40% / 20%" labels still visible

These come from the stored Chemistry syllabus AO definitions (A1=40, A2=40, A3=20). The bucket rollup hides them in some panels but several places still render the raw sub-code numbers:

- **`src/routes/new.tsx`** — `CoverageStrips` (lines 1280–1300) iterates raw `aos` and prints `target {a.weightingPercent}%`, producing the `A1 / target 40%`, `A2 / target 40%`, `A3 / target 20%` rows. The AO selector list (~line 2021) also shows `[40%]`, `[20%]` next to each sub-code.
- **`src/components/BuilderCoachPanel.tsx`** (~626–637) — "rolled up from A1 40%, A2 40%, A3 20%" caption and the italic helper line.
- **`src/routes/paper-set.$id.tsx`** (~968–972) — same "rolled up from …" caption under each bucket bar.

### Fix
1. In `new.tsx` `CoverageStrips`, switch from raw `aos` to bucketed rows: use `bucketTargets(aos)` for targets and `rollupCounts(aoMarks)` for actuals. Render one row per letter bucket (A, B, …) — no sub-code rows, no `[40%]` chips. Drop the `missingAOs`/`publishedAOs` checks that key on sub-codes; rebuild against bucket codes.
2. In the AO selector list (~2021) keep the sub-code rows for tagging (functional), but remove the `[{weightingPercent}%]` chip so the 40/20 numbers disappear.
3. In `BuilderCoachPanel.tsx` `AlignmentStrip`, remove the "rolled up from …" sub-code caption and the italic footer line.
4. In `paper-set.$id.tsx` `AOPanel`, remove the same "rolled up from …" caption (keep only the bucket-level bar + observed vs declared).

After these edits, the only AO percentages shown are bucket-level (A, B, …) so the legacy 40/40/20 numbers no longer appear anywhere.

## Issue 2 — Recalculate button "doesn't recalculate"

The `Recalculate with AI` button only invokes `retag-questions`, which rewrites each question's `ao_codes / knowledge_outcomes / learning_outcomes` from the AI. It does **not** touch the syllabus AO target weightings (those live in `syllabus_assessment_objectives` and define the "target %" you see).

So if a Chemistry paper's stored AO defs are A1/A2/A3=40/40/20, those target numbers stay the same after recalc — only the bars (actuals) move. That's likely why it "doesn't seem to recalculate".

Two fixes needed:

1. **Re-render after recalc** — confirm the panel re-reads questions. `retagAllQuestions` already calls `loadAll()` after success, but the AO Coverage card on `assessment.$id.tsx` derives from `questions` state. Add a `console.log` of the `payload.updated/total/errors` to confirm; if `updated === 0`, surface that in the toast as a warning ("No questions changed — check section AO pool"). If errors exist, show the first error message instead of a silent success.
2. **Make targets responsive to the bucket model** — when the stored AO defs have only sub-codes (e.g. only A1/A2/A3 with no B), the bucket rollup currently produces `A=100%` and no B target, which is misleading. Two options to pick from:
   - **(a) Hide targets entirely** for papers whose stored defs cover only one bucket — render bars without the target tick / "vs N%". Cleanest, no data migration.
   - **(b) Add a manual override** on `/admin/syllabus/:id` for bucket-level AO weighting (A=50, B=50) that wins over sub-code weights. Requires a small admin UI change but lets the user fix Chemistry to the real 50/50 model.

### Open question for you
- For Issue 2 fix #2, do you want **(a)** auto-hide targets when sub-codes don't cover all buckets, or **(b)** an admin override field so you can set A=50, B=50 yourself? I lean (b) because it gives you the right targets going forward; (a) is faster but loses the target tick on the bars.

## Files touched

- `src/routes/new.tsx` — bucket rollup for `CoverageStrips`, drop weighting chip in AO selector
- `src/components/BuilderCoachPanel.tsx` — remove sub-code caption + footer line
- `src/routes/paper-set.$id.tsx` — remove sub-code caption in `AOPanel`
- `src/routes/assessment.$id.tsx` — better recalc toast (updated/total/errors)
- *(if option b chosen)* `src/routes/admin.syllabus.$id.tsx` + a small migration for bucket-level AO rows
