# Fix LO tagging recall in paper classifier

## Problem

The shared classifier (`supabase/functions/_shared/classify.ts`, used by both
`parse-paper` and `reclassify-paper`) misses obvious topics like "Acids and
Bases" because of how it filters the syllabus catalogue *before* the AI sees
it. Three concrete causes:

1. **Per-batch pre-pruning by token overlap** keeps only the top 60 of up to
   500 syllabus entries. Pruning is computed against a *batch of 6 questions
   together*, so an off-topic question in the same batch can crowd out the
   right topic. Synonyms in the syllabus (e.g. "proton donor",
   "neutralisation") don't share tokens with question text saying "acid".
2. **LO truncation to 6 per topic** in the prompt — any LO past the 6th is
   invisible.
3. **One topic per question** — cross-topic questions lose the secondary tag.

## Fix

Edit `supabase/functions/_shared/classify.ts` only. No DB changes, no UI
changes, no schema changes. Behavior stays the same on small catalogues.

### 1. Score and prune per question, not per batch

Replace `pruneCatalogue(catalogue, batch, 60)` with a per-question scorer:
- Build the batch's pruned set as the **union of each question's top-K
  topics** (K = 12) plus any topic whose `topic_code` already appears in any
  question's existing tags.
- Cap final size at 90 (was 60). Fits comfortably in the prompt.
- Score against `title + learning_outcomes + knowledge_outcomes + topic_code`,
  and also boost when a question token equals the **first significant word
  of the topic title** (so "acid" hits "Acids and Bases" even if the LO text
  uses "proton donor").

### 2. Add a synonym/stem boost

Tiny static map in the file: e.g. `acid ↔ acidic, acidity, neutralis*,
proton donor, ph`; `base ↔ alkali, alkaline, hydroxide`; `oxidation ↔ redox,
electron loss`. Used only for scoring (not sent to the AI). Keeps the change
deterministic and reviewable.

### 3. Stop truncating LOs in the prompt

Change `(t.learning_outcomes ?? []).slice(0, 6)` to send all LOs, but
truncate each LO string to ~140 chars. Net token cost is similar but recall
improves.

### 4. Allow up to 2 topic codes per question

Update the `save_classifications` tool schema:
- Add optional `secondary_topic_code: string` and
  `secondary_learning_outcomes: string[]`.
- Merge into the result so `learning_outcomes` and `knowledge_outcomes`
  arrays union both topics. `topic_code` stays the primary.

### 5. Smaller batches by default

Lower `batchSize` default from 6 → 4. Reduces cross-question contamination
of the pruned shortlist. Slight cost increase, well under the per-batch
60s timeout.

### 6. Better keyword fallback

Lower the score-2 floor to score-1 when the question has ≤5 content tokens,
and let the fallback return the **top 2** topics (not 1). Keeps the
"never empty" guarantee but adds breadth.

## Technical details (for reviewers)

- Files changed: `supabase/functions/_shared/classify.ts` only.
- Functions to redeploy: `parse-paper`, `reclassify-paper`.
- No client changes; the existing "Re-classify" button in the paper-set
  review UI is sufficient to retag previously-parsed papers.
- Risk: prompt size grows ~30%. Still well within Gemini Flash limits
  (catalogue lines stay under ~250 tokens each × 90 = ~22k tokens; question
  payload ~3k; system prompt small).
- Validation: after deploy, run reclassify on the user's existing paper set
  and compare LO coverage for chemistry questions mentioning acid/base/pH
  before vs after.

## What this does NOT change

- The macro reviewer logic, status chips, or any UI.
- The blueprint/section-pool tagger (`retag-questions`) used by the
  authoring flow — that one already filters strictly to a curated section
  pool and is not affected.
- Database schema, RLS, or stored question rows beyond what reclassify
  rewrites.
