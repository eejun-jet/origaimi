## What's wrong today

The AO review treats `A1`, `A2`, `A3` as if they were the top-level AO buckets, with stored weightings of `40 / 40 / 20`. That is why `A2` and `A3` show only a few percent — most marks are getting tagged with sibling codes (`A4`, `A5`, `B1..B7`, `C1..C6`) that the panel shows as separate rows.

The correct model is letter-prefix buckets:

```text
A  =  A1 + A2 + A3 + A4 + A5             -> 50%
B  =  B1 + B2 + B3 + B4 + B5 + B6 + B7   -> 50%
C  =  C1 + C2 + C3 + C4 + C5 + C6        -> only if the syllabus declares it
```

The number after the letter is the sub-objective, not a separate AO.

## Fix

### 1. Add an AO rollup helper

New file: `src/lib/ao-rollup.ts`

- `bucketOf(code)`: returns the letter prefix (`"A"`, `"B"`, `"C"`, …). Falls back to the original code if it doesn't match the `^[A-Z]\d+$` shape, so non-coded tags ("Untagged", custom labels) are preserved.
- `rollupCounts(map)`: takes a `Map<code, number>` and returns a `Map<bucket, number>`.
- `bucketTargets(aoDefs)`: aggregates declared `weighting_percent` per bucket from `syllabus_assessment_objectives`. If any single canonical bucket already has a declared weight (e.g. `A=50`), use that. If only sub-codes are stored (`A1=40, A2=40, A3=20`), sum them into the bucket (`A=100`). Then re-normalise so buckets sum to 100. For Chemistry/Combined Science this yields `A=50, B=50` (and `C` when present).

This keeps existing data working without a database migration.

### 2. Assessment Coach AO snapshot — `src/lib/intent-coach.ts`

- Switch `aoFrequency` to weight by **marks per section**, not `num_questions`.
- After counting, run the result through `rollupCounts`.
- `computeAlignmentSummary` returns one row per bucket (`A`, `B`, `C` …), each with `plannedPercent` vs `targetPercent` from `bucketTargets`.
- The cheap "AO target delta" signal compares bucket totals, so `A` at 80% vs 50% target shows up as a single clear nudge instead of three confusing A1/A2/A3 rows.

### 3. Generated assessment review — `/assessment/:id`

Same rollup before rendering, so this Chemistry paper shows:

```text
A   actual %   vs   50%
B   actual %   vs   50%
```

Rows for `A1..A5` and `B1..B7` are removed from the headline view. They stay available as a "show sub-codes" expand toggle for users who want the granular breakdown.

### 4. Paper-set AO review — `/paper-set/:id`

`paper-set.$id.tsx` (`aoMarkShare`, `AOPanel`, `PerPaperPanel`) gets the same treatment so the macro review matches the per-assessment review.

### 5. Builder UI — `BuilderCoachPanel.tsx`

`AlignmentStrip` renders the bucket rows. Sub-codes that contributed >0% are listed underneath as a thin caption (`A ← A1 12%, A2 18%, A4 14%, A5 6%`) so the rollup is transparent.

### 6. Caveat note in the UI

Small one-liner under the AO panel:

```text
A1–A5 are rolled up to A, B1–B7 to B, to match the syllabus-level AO weighting.
```

Prevents confusion for users who remember seeing the granular tags earlier.

## Out of scope

- Re-tagging or re-classifying parsed past papers — current tags are fine once rolled up.
- Rewriting `syllabus_assessment_objectives` rows in the database. The rollup is computed at read time.
- Changing how AI generation picks AO codes for new questions.

## Files touched

- new: `src/lib/ao-rollup.ts`
- edit: `src/lib/intent-coach.ts` (mark-based weighting + rollup)
- edit: `src/components/BuilderCoachPanel.tsx` (`AlignmentStrip` shows buckets, caption with sub-codes)
- edit: `src/routes/assessment.$id.tsx` (AO review uses buckets)
- edit: `src/routes/paper-set.$id.tsx` (`AOPanel`, `PerPaperPanel` use buckets)
