## What's wrong (root cause)

1. **Tile colours** — In `src/routes/paper-set.$id.tsx` (`CoverageExplorer`) tiles are tinted by coverage status only (emerald / amber / muted). There is no per-discipline border colour. KOs from Physics, Chemistry, Biology all look identical inside their grouped section.

2. **No status chip on tiles** — Each tile shows the discipline badge + a coverage bar, but no "Untested / Under-tested / Over-tested" chip like the Assessment Coach's KO/LO Explorer (`assessment.$id.tsx` uses `STATUS_META` with chips). Filter chips at the top use the same buckets but each tile doesn't surface the verdict.

3. **0 LOs picked up by macro review** — Inspected the actual data for the user's "test" set (two real Sec 4 Combined Science papers):
   - Every question has `ao_codes=["A1","A2"]` (looks like a stub from initial parse, not real AO1/AO2/AO3), `topic_code="PHY.K"` etc. that don't match the syllabus topic_codes `1.1, 1.2, …`, and **`learning_outcomes=[]`, `knowledge_outcomes=[]` for every question in both papers**.
   - The macro review aggregates LOs/KOs from `questions_json`, so with 0 LOs/KOs tagged, "unrealised" is everything and "covered" is nothing — the panel is correct given the input but the input is empty.
   - The fix already exists: the "Reclassify all papers" button in the header runs `_shared/classify.ts` which batches questions against the matched syllabus and writes real LOs/KOs/AOs. The user just hasn't run it, and the macro review doesn't auto-trigger it. The amber "questions have no syllabus tags yet" warning only fires when **no AO/KO/LO** is present — but here the seed `["A1","A2"]` AO codes pass the check, so the warning is suppressed even though LOs are empty.

## Plan

### 1. Per-discipline border colours on KO tiles
In `CoverageExplorer` (`src/routes/paper-set.$id.tsx`), introduce a `disciplineTone(disc)` helper that returns a left-border colour class:
- Physics → `border-l-4 border-l-blue-500`
- Chemistry → `border-l-4 border-l-emerald-500`
- Biology → `border-l-4 border-l-rose-500`
- Practical → `border-l-4 border-l-amber-500`
- General/other → `border-l-4 border-l-slate-400`

Compose it with the existing coverage tint (`tone`) so the card keeps the soft fill but gains a coloured spine. Apply the same accent to the discipline section header.

### 2. Add Untested / Under-tested / Over-tested chip to each tile
Reuse the same `classify(g)` already in `CoverageExplorer` and add an "over" case using the Assessment Coach rule (covered ratio > 80% AND set-wide avgCov < 70% AND delta ≥ 30pp). Render a small chip in the top-right of each tile (replacing or alongside the discipline `Badge`):

```
Untested      → red    (bg-destructive/15 text-destructive border-destructive/30)
Under-tested  → amber  (bg-amber-500/15 text-amber-700 border-amber-500/30)
Covered       → emerald
Over-tested   → purple (bg-purple-500/15 text-purple-700 border-purple-500/30)
```

Also extend the filter row to include "Over-tested" so users can isolate it, mirroring the KO/LO Explorer.

### 3. Make macro review actually see LOs

Two complementary fixes:

**a. Tighten the "needs reclassify" detector.** Change the warning + the edge-function gate from "no AO/KO/LO at all" to **"≥50% of questions have empty LOs *and* empty KOs"** (ignore AO codes — many seed/parse paths fill those in). This means the user's test set would correctly surface the amber warning and the macro review would refuse with a `needs_reclassify: true` (which the UI already renders with a "Reclassify now" action).

Files:
- `src/routes/paper-set.$id.tsx` — update `untaggedCount` / `untaggedByPaper` predicates.
- `supabase/functions/paper-set-review/index.ts` — change `unclassifiedQuestions` counter to use the same LO-empty + KO-empty rule.

**b. One-click "Run macro review" auto-reclassifies first.** In `runReview`, if the precheck shows the LO/KO tagging gap, run `reclassifyAll()` automatically (with a toast: "Tagging questions before review…"), then call `paper-set-review`. This removes the two-step dance and matches the user's expectation that uploading real papers + clicking "Run macro review" should just work.

### 4. Sanity: discipline lookup uses titles too
The Combined Science syllabus topics use `section` like "Physics", "Chemistry" — the existing `buildDisciplineLookup` already covers this, so once LOs are populated the per-tile discipline (and therefore the new border colour) will be correct.

## Files to edit
- `src/routes/paper-set.$id.tsx` — tile borders, status chip, "Over-tested" filter, tightened tagging-gap detector, auto-reclassify-then-review flow.
- `supabase/functions/paper-set-review/index.ts` — same tagging-gap rule on the server side.

No DB migrations, no new dependencies.