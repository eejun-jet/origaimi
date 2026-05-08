## Why the AO drift looks so significant

The set is real Combined Science (5086/5087/5088) papers — the drift isn't a tagging quality problem, it's an **apples-to-oranges comparison** in the review function.

The syllabus stores AOs at two levels in the same flat table:

| Code | Title | Declared weighting |
|---|---|---|
| **A1** | Knowledge with Understanding | **40%** ← parent |
| **A2** | Handling Information and Solving Problems | **40%** ← parent |
| **A3** | Experimental Skills and Investigations | **20%** ← parent |
| A4, A5 | Knowledge with Understanding | — (sub-AOs of A1) |
| B1–B7 | Handling Information and Solving Problems | — (sub-AOs of A2) |
| C1–C6 | Experimental Skills and Investigations | — (sub-AOs of A3) |

The question tagger almost always picks the **fine-grained sub-code** (A4, B5, B1, C2 …) — confirmed by counts across the 6 papers in this set: A1=45, A4=37, B5=29, B1=20, B7=16, B4=15, B2=12, A2=10, A3=3, C1–C6=4 total.

`paper-set-review/index.ts` then compares each code's observed mark-share to its own `weighting_percent`. Since only A1/A2/A3 have declared weights, the function reports:

- A1 28.6% vs declared 40% → "undersubscribed" (false — the rest of the A-family is in A4/A5)
- A2 2.6% vs 40% → "significantly undersubscribed" (false — it's all in B1–B7)
- A3 0.3% vs 20% → "barely assessed" (false — papers don't carry C-band practical, and A3 work was tagged into B*)
- A4 16.3%, B5 14.5% → flagged "conspicuously high, no declared weighting"

So the AI is flagging a structural mismatch in our data model, not a real coverage problem with the school's papers.

## Proposed fix

Roll sub-AOs up to their parent AO before computing drift, using the existing `title` field as the grouping key (every sub-AO shares its parent's title):

1. In `supabase/functions/paper-set-review/index.ts`, when building `aoStats`:
   - Identify "parent" AOs as those with a non-null `weighting_percent`.
   - Build a `childToParent` map: for every AO whose `weighting_percent` is null, find the parent AO with the same `title` (Knowledge with Understanding → A1, Handling Information… → A2, Experimental Skills… → A3). Map child code → parent code.
   - When accumulating `aoMarks`, if a tagged code has a parent, credit the parent code as well (or only the parent — see step 3).
   - Compute `observed_pct` only over the parent set.
2. Pass only parent-level `aoStats` and `aoDefs` into the AI prompt. Sub-AOs remain in the database for finer reporting later but are not part of the macro drift table.
3. Edge case — if a code has no parent mapping (e.g. a fully separate AO with declared weight, or a sub-AO whose title doesn't match any parent), keep it as its own row, as today.
4. Add a one-line comment explaining the rollup so future maintainers understand why drift is parent-only.

No DB migration, no UI change, no impact on other functions (`coach-review`, `BlueprintTargetsCard`, etc. don't compare against declared weightings the same way). The `paper_set_reviews.snapshot` shape is unchanged — only the values in `findings.ao_drift` will become realistic.

After deploy, re-running the review on this set should show A1/A2/A3 each within a few points of 40/40/20 (as expected for a real school paper), and no spurious A4/B5 callouts.

## Scope

- `supabase/functions/paper-set-review/index.ts` — add rollup before `aoStats` and prompt assembly.
- No other files.

## Want me to proceed?

If you'd like, I can also surface the rolled-up parent-vs-sub breakdown in the UI later as a "drill-down" — but that's a separate enhancement. The fix above is enough to make the drift readout trustworthy.