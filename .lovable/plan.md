# Why the analysis came back empty

I traced your "Year 2024 P1 Comb Sci Phy Chem" analysis (`assessments.fa8e85ce…`). Every row in `assessment_questions` has empty `ao_codes`, `learning_outcomes`, `knowledge_outcomes` and `topic` — that's why the Coverage Explorer can't render anything (it pivots on those fields against the syllabus).

The reason isn't the analyser — it's the **upstream parse**. `analysePastPaper` (in `src/lib/analyse-past-paper.ts`) just copies the AO / KO / LO arrays straight from `past_papers.questions_json` into the new assessment rows. If those arrays were empty on the paper, the assessment is empty too.

For comparison, your other recent paper "Sc(Phy) Prelims 2025 P2" parsed cleanly — its analysis has full AO codes, LOs and topic codes. That paper just happened to get a working classifier batch; the Comb Sci paper didn't.

**What goes wrong during parse:** `parse-paper` calls `classifyQuestionsBatched` against the matching syllabus (`Sciences` / `Sec 4` exists — `8df0320d…`). When the LLM batch times out or returns a malformed JSON, the function silently writes empty arrays for that batch's questions. We already have a recovery edge function — `reclassify-paper` — but it's only wired into the **Paper Sets** page (`src/routes/paper-set.$id.tsx`), not the **Papers** list, so you had no way to trigger it from where you were.

Side note: `knowledge_outcomes` is empty even on the working Phy P2 paper. That's a separate, pre-existing gap in the classifier prompt — KO inference isn't being produced. Worth flagging but not part of this fix unless you want it tackled now.

# Plan

1. **Surface a "Reclassify" action on the Papers page** (`src/routes/papers.tsx`)
   - Per-row button (icon + tooltip) that calls `supabase.functions.invoke("reclassify-paper", { body: { paper_id } })`.
   - Show a toast with the result (`classified / total`, `via_ai`, `failed_batches`).
   - Reuse the same loading/disabled pattern already in `paper-set.$id.tsx` (`reclassifying` state).

2. **Auto-heal on Analyse** (`src/lib/analyse-past-paper.ts`)
   - Before building rows, check whether ≥50% of questions have empty `ao_codes` AND empty `learning_outcomes`.
   - If so, invoke `reclassify-paper` once, then re-fetch `questions_json` and continue.
   - This means future analyses of an under-classified paper recover automatically instead of producing an empty Coverage Explorer.

3. **Friendly empty-state in the analysis view** (`src/routes/assessment.$id.tsx`, Coverage tab)
   - When all questions have empty AO/LO arrays, render a small banner: "This paper hasn't been classified yet — open it from Papers and click Reclassify, then re-run Analyse."
   - Pure presentation; no logic change to coverage math.

4. **Recover your current bad analysis**
   - The source paper (`past_papers.7fe84350…`) is no longer in the database, so the failed analysis can't be re-healed in place. Easiest path is to re-upload that PDF; with step 2 in place the next Analyse will populate AO/LO automatically.

## Out of scope (flag only)
- Fixing the empty `knowledge_outcomes` across all parsed papers (classifier prompt change in `supabase/functions/_shared/classify.ts`). Happy to do this as a follow-up if you want.
