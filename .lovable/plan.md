# Real root cause

`parse-paper` is the bug. It computes classifications correctly (the log even shows `40/40 classified, 0 failed batches`), but it **never merges them back into `past_papers.questions_json`** before saving — it writes the raw `questions` array.

Concretely, in `supabase/functions/parse-paper/index.ts`:

- Line 395: `classifications = outcome.classifications` — populated.
- Lines 408–420: `classifications` is fed into `buildBankRows` (so `question_bank_items` rows get AO/LO/KO).
- Line 456: `questions_json: questions` — saves the **un-merged** array.

So every freshly-parsed paper has empty `ao_codes`, `learning_outcomes`, `knowledge_outcomes`, `topic_code` inside `questions_json`. `reclassify-paper` happens to write them correctly (it does the merge), which is why papers you'd previously reclassified looked fine and the new "2024 Comb Sci P1 (Phy Chem)" upload didn't.

The auto-heal I added in `analyse-past-paper.ts` would have fixed it, but it never ran for the latest attempt — the edge function logs show no `reclassify-paper` calls. Most likely the new client bundle hadn't loaded yet when you re-analysed within seconds of upload. Even so, fixing the source bug is the right place to land this.

# Plan

1. **Fix `parse-paper` to merge classifications into `questions_json`**
   - Before line 456 (`await supabase.from("past_papers").update(...)`), build `questionsWithClassifications = questions.map((q) => { const cls = classifications[q.number]; return cls ? { ...q, topic_code, topic, bloom_level, ao_codes, learning_outcomes, knowledge_outcomes } : q; })`.
   - Save that merged array as `questions_json` instead.
   - Mirror the same merge logic `reclassify-paper` already uses, so the two paths produce identical shapes.

2. **Heal already-broken papers in the DB**
   - Use the existing `Reclassify` button I added to the Papers page to fix the broken "2024 Comb Sci P1 (Phy Chem)" paper.
   - Re-run **Analyse paper** afterwards. The Coverage Explorer will populate.
   - (Optional, ask before doing) Run a one-shot script that loops over all `past_papers` where every question has empty `ao_codes` and invokes `reclassify-paper` so older imports get healed automatically.

3. **Keep the safety net**
   - Leave the auto-heal in `analyse-past-paper.ts` and the empty-state banner in the Coverage tab. They become belt-and-braces once parse-paper writes correctly.

## Out of scope (flag only, don't touch unless asked)
- The classifier still produces empty `knowledge_outcomes` for almost every question. Separate prompt fix in `supabase/functions/_shared/classify.ts`.
- Older `past_papers` rows uploaded before this fix will keep their empty `questions_json` until reclassified.
