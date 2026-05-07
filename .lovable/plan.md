## Why the review came back empty

The macro review for your set ran, but every paper had **0 questions tagged with learning_outcomes / knowledge_outcomes / ao_codes** — so the AI had nothing to reason over. The aggregation in `paper-set-review` happily summed zeros, and "unrealised LOs/KOs" became *the entire syllabus* (which is then truncated to a generic blob).

### Root cause

In `supabase/functions/parse-paper/index.ts` (line 351–359) the classifier looks up the syllabus with:

```ts
.eq("subject", subjectName)
.eq("level", levelName)
.eq("parse_status", "ready")     // ← wrong value
```

But `parse-syllabus/index.ts` writes `parse_status = "parsed"` (line 266), and the DB confirms it: the only Sciences/Sec 4 syllabus has status `parsed`, not `ready`. The lookup returns null, the classifier is skipped, and every parsed question is saved with empty `ao_codes / learning_outcomes / knowledge_outcomes`. I verified this for all 6 QPs in your set — `los_q = 0`, `ao_q = 0` across 62 questions.

A second, smaller issue: the set includes both QP and MS papers. The MS rows duplicate the question count and confuse the AO mark-share. Reviews should run over QPs only (mark-schemes don't carry assessment demand).

## Fix

1. **`supabase/functions/parse-paper/index.ts`** — change the syllabus filter from `.eq("parse_status", "ready")` to `.in("parse_status", ["ready", "parsed"])` so it tolerates both values.

2. **Backfill the existing set** — run a one-shot script (edge invocation loop) that re-invokes `parse-paper` for the 12 papers in set `582e48ab…` so they get classified against syllabus `8df0320d…`. After this, each question row will carry `ao_codes`, `learning_outcomes`, `knowledge_outcomes`.

3. **`supabase/functions/paper-set-review/index.ts`** — when aggregating, skip papers whose title starts with `[MS]` (or whose `paper_number` indicates mark scheme) so AO mark-share and totals reflect actual assessment demand, not duplicated MS rows. Add a `papers_used` count to the response so the UI can show "reviewed 6 QPs of 12 papers".

4. **`src/routes/paper-set.$id.tsx`** — surface a small caption under the review summary: "Reviewed N question papers · X questions · Y marks" using the new field, and show a yellow note if any QP in the set still has 0 classifications (so the user knows to retry parse rather than blame the review).

5. **Optional belt-and-braces**: write a tiny migration to normalise `syllabus_documents.parse_status` so future code can rely on a single value (`'ready'`). I'll keep the parse-paper filter accepting both regardless.

## Files touched

- `supabase/functions/parse-paper/index.ts` — fix the `.eq` filter
- `supabase/functions/paper-set-review/index.ts` — exclude `[MS]` papers, return `papers_used`
- `src/routes/paper-set.$id.tsx` — show coverage caption + classification warning
- one-off backfill via `supabase.functions.invoke("parse-paper", { body: { paperId } })` for the 12 papers in the current set
- (optional) migration normalising `parse_status` on `syllabus_documents`

## Expected outcome

After this, "Run review" on your set will:
- find the syllabus, classify every QP question with AO/KO/LO,
- aggregate AO mark-share across the 6 QPs (P1, P2, P3, P5 × Phy + Chem),
- list real unrealised KOs/LOs (filtered to Physics + Chemistry only because of `scoped_disciplines`),
- and produce 1–4 calm priority insights instead of an empty summary.
