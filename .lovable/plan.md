## Goals

1. Default the "Knowledge & Learning Outcome Coverage" view to **By KO** (currently it's the third tab; topic view is the default for science papers).
2. Eliminate the misleading **"Unmapped LO metadata"** bucket that appears even when every LO has a KO in the syllabus.

## Why "Unmapped LO metadata" shows up today

In `src/routes/assessment.$id.tsx`, `koLoGroups` (line ~2727) builds the KO → Content → LO hierarchy by walking each section's `topic_pool` and collecting LO **text**. Any LO present in the paper rollup (`paper.los`) whose text wasn't seen during that walk is dumped into a single "Unmapped LO metadata" bucket (line ~2841).

The walk only touches `t.learning_outcomes` from rows in `topic_pool`. An LO becomes "orphan" whenever the exact LO text on a question (or in `section.learning_outcomes`) doesn't string-match any text inside any `topic_pool[*].learning_outcomes` for the sections in the paper. This happens routinely:

- The section was generated from a syllabus subset that didn't load the full topic pool (the section was saved with `learning_outcomes` listed flat, but `topic_pool` is empty or partial).
- Whitespace / punctuation / casing differences between the LO string stored on the question and the LO string in the syllabus row.
- The AI tagger produced a paraphrased LO string that no longer exactly matches the syllabus.
- The teacher edited an LO statement.

So even though every LO logically has a KO, the bucket is a string-equality artefact, not a real data gap.

## Fix

### 1. Default "By KO" tab

`src/routes/assessment.$id.tsx` line 2699:

```ts
const [loView, setLoView] = useState<"topic" | "map" | "list">(isScience ? "topic" : "list");
```

Change the default to `"list"` for every subject so the "By KO" view shows first. Also reorder the toggle buttons so **By KO** is rendered first, then **By topic**, then **Map**, matching the new default.

### 2. Map orphan LOs back to a real KO instead of dumping them in "Unmapped"

Inside the `koLoGroups` memo (lines ~2727–2862), build a robust LO→KO lookup before the orphan pass:

a. **Normalised text index.** While walking `topic_pool`, also store each LO under a normalised key (`lower-case, collapse whitespace, strip trailing punctuation`) → `{ koName, contentName, code }`. Re-check orphan LOs against this normalised index first; if a match is found, place the LO into that KO/Content bucket instead of the orphan bucket.

b. **Section-level fallback.** If still no match, look at the LO's owning section(s) (the sections whose `learning_outcomes` array contains this text, or whose questions reference this LO). Use that section's `knowledge_outcomes` (or, if empty, the union of `outcome_categories` from its `topic_pool`) to attach the LO to the most likely KO. The Content bucket name in this case is the section's name, e.g. "Section A — Cells & Energy", so it's clear where the LO came from.

c. **Drop the "Unmapped LO metadata" bucket entirely.** After (a) and (b), any remaining truly-orphan LO (no syllabus match and no section KO) is logged via `console.warn` for diagnostics, but **not** rendered as a bucket. Empirically, with steps (a)+(b) the orphan set is virtually always empty — and when it isn't, surfacing a confusing UI bucket is worse than silently logging it.

d. Remove the special sort branch for `"Unmapped LO metadata"` (lines 2856–2857) and the `koRemarks` guard at line 3085, since the bucket no longer exists.

### 3. No changes elsewhere

- `paper.los` calculation (line ~1888) is left alone — it's still the source of truth for "covered/uncovered" counts; only the grouping logic changes.
- Coverage Explorer (full-screen drilldown) consumes the same `koLoGroups`, so it inherits the fix automatically.
- `By topic` and `Map` views (used for science) are untouched; users can still switch to them, they just aren't the default.

## Files touched

- `src/routes/assessment.$id.tsx` — default `loView`, tab button order, `koLoGroups` memo (orphan re-mapping + drop "Unmapped" bucket), small cleanup of the two references to "Unmapped LO metadata".

No database / edge-function changes.
