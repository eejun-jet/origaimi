## Root cause (confirmed against your data)

I queried your set `test` (5 papers, all `parse_status=ready`) and the parsed `questions_json` for every question across all 5 papers. **Every single question has `ao_codes=[]`, `learning_outcomes=[]`, `knowledge_outcomes=[]`.** The macro reviewer is working correctly — there is simply nothing to aggregate.

Edge function logs for `parse-paper` confirm it:

```
[parse-paper] classifier timeout, proceeding without
[parse-paper] classifier timeout, proceeding without
... (one per paper)
```

What's happening in `supabase/functions/parse-paper/index.ts`:

1. After extracting questions, it looks up the matching syllabus (`Sciences` / `Sec 4` → 103 topics — found correctly).
2. It sends **all 20+ questions + 200 catalogue rows in one prompt** to `google/gemini-2.5-flash` and races it against a hard **30 s timeout**.
3. For your Sciences (Phy/Chem combined) papers that prompt is huge, the model regularly takes >30 s, the timeout fires, classifications are dropped, and questions are saved tagged with empty arrays.
4. `paper-set-review` then sees `totalMarks > 0` but every question contributes `unclassifiedQuestions++`, so the AI gets empty AO observed share and empty union of KOs/LOs and produces a vacuous review.

So the fix isn't in the reviewer — it's in classification. And we also need to repair the 5 papers already in the DB without you re-uploading them.

## Plan

### 1. Make the classifier in `parse-paper` actually finish

In `supabase/functions/parse-paper/index.ts`:

- Replace the single all-questions call with **batches of 6 questions** in parallel (cap concurrency at 3) so each AI call has a small payload and finishes in seconds.
- Trim the catalogue we send per batch: pre-rank topics by keyword overlap with the batch's stems and send the top ~60 (full catalogue is too large and unnecessary for any one batch).
- Raise the per-batch timeout to 60 s, and on timeout/HTTP error **retry once** with `google/gemini-2.5-flash-lite` before giving up on that batch.
- Log a one-line summary at the end: `classifier: classified X/Y questions in Z batches`.
- If a batch ultimately fails, fall back to a deterministic keyword-match against the catalogue so we still emit at least a topic_code + AO guesses (better than `[]`).

### 2. Add a "Reclassify" button + edge function for already-parsed papers

New edge function `reclassify-paper`:

- Input: `{ paper_id }`.
- Loads `past_papers.questions_json`, finds matching syllabus doc, runs the new batched classifier, then:
  - Updates `past_papers.questions_json` so each question has populated `ao_codes`, `learning_outcomes`, `knowledge_outcomes`, `topic_code`, `bloom_level`.
  - Re-fans the rows into `question_bank_items` (delete + insert by `past_paper_id`, same as parse-paper does today).
- Returns `{ classified, total }` so the UI can show progress.

UI: in `src/routes/paper-set.$id.tsx`, next to each paper row add a small **Reclassify** action; and a top-level **Reclassify all papers** button that calls the function for each paper sequentially with a toast progress count. After it finishes, automatically re-run the macro review.

### 3. Make the macro reviewer honest about coverage gaps

In `supabase/functions/paper-set-review/index.ts`:

- If `unclassifiedQuestions / totalQuestions > 0.5`, return a clear error like `"Most questions in this set have no syllabus tags yet. Click Reclassify to tag them, then re-run the review."` instead of asking the AI to guess from nothing.
- Include `unclassified_questions` and `papers_used` in the response (already there) and surface them in the UI as a small banner above the findings.

### 4. One-time backfill for your existing 5 papers

After deploying (1) and (2), I'll call `reclassify-paper` for the 5 papers in set `test` (`46e7ee81-…`) so your current set works without you doing anything, and then re-run `paper-set-review` so you see real findings.

## Files touched

- `supabase/functions/parse-paper/index.ts` — batched classifier with retry + keyword fallback.
- `supabase/functions/reclassify-paper/index.ts` — **new**, reuses the classifier.
- `supabase/functions/paper-set-review/index.ts` — guard + richer response.
- `src/routes/paper-set.$id.tsx` — Reclassify buttons + coverage banner.
- `supabase/config.toml` — register the new function (no `verify_jwt` change needed).

## Out of scope

- No DB schema changes. No auth changes. No changes to upload flow.
