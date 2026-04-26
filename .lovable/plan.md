## Problem

The Coverage panel and the Assessment Coach both judge a Learning Outcome (LO) or Knowledge Outcome (KO) as "covered" only when its **exact text** appears in the question's tag array. In practice:

- The LLM tags conservatively — it usually names just the single most central LO, even when the stem genuinely exercises 2–3 LOs from the section's pool.
- A structured question with multi-part sub-questions naturally spans several LOs, but only one gets tagged.
- A KO category like "Application" is often tagged once but actually demanded by multiple items.

Result: legitimately-covered outcomes show as red "uncovered", and the Coach repeats the false negative in its "Unrealised KO/LO" finding.

## Fix — three layers

### 1. Stronger tagging at generation time (prompt)

In `supabase/functions/generate-assessment/index.ts`, tighten the `objectivesBlock` instructions in `buildSectionUserPrompt` so the LLM is required to tag **every** LO/KO/AO from the section pool that the question genuinely demonstrates — not just the primary one.

- Add an explicit rule: "Tag ALL applicable LOs/KOs from the pool, not just the most central one. A multi-part structured question typically tags 2–4 LOs; a source-based sub-question with compare/infer/evaluate skills typically tags 2 KOs (e.g. Understanding + Application)."
- Add a worked mini-example showing a stem and the tag set that should accompany it.
- Tighten the tool-schema descriptions for `ao_codes`, `knowledge_outcomes`, `learning_outcomes` to say "include every objective the stem AND its sub-parts genuinely demand".

### 2. Semantic coverage post-pass (server-side, deterministic)

Even with a stronger prompt the model will still under-tag occasionally. Add a deterministic enrichment pass that runs **after** the LLM returns and **before** rows are inserted, inside the `generate-assessment` function:

- For each generated question, take the section's full LO pool + KO pool + AO pool.
- For every LO/KO/AO in the pool, check whether the question's `stem + answer + mark_scheme + topic` text demonstrates it. Use a lightweight matcher:
  - **LOs**: tokenise the LO statement (lowercase, drop stopwords, keep noun + verb stems). If the question text contains ≥ 60% of the content tokens (or all rare/proper nouns), add the LO to the question's `learning_outcomes`.
  - **KOs**: map command words / Bloom verbs in the stem to KO categories (recall/define/state → Knowledge; explain/describe → Understanding; apply/calculate/use/infer → Application; compare/evaluate/analyse → Skills). Add any matched KO that's in the section pool.
  - **AOs**: same Bloom-verb → AO mapping that the Coach already uses (sciences vs humanities split). Add the inferred AO only if it's already in the section's AO pool.
- The pass only **adds** tags; it never removes a tag the LLM emitted. Final tag list = union of LLM tags + inferred tags, deduplicated.
- Keep the heuristics in a new file `supabase/functions/generate-assessment/coverage-infer.ts` so they can be unit-tested and shared with the regenerate-question function.

### 3. Apply the same enrichment in the Coverage UI and Coach review

So existing assessments (already saved with sparse tags) also benefit without forcing a regenerate:

- **Coverage UI** (`src/routes/assessment.$id.tsx`): in `computeCoverage`, before the strict `.includes` checks, run each question through a client-side mirror of the matcher (small pure function) to expand its effective tag set. Cache per-question. The on-screen tags shown in question editors stay as the saved values; coverage uses the expanded set.
- **Coach review** (`supabase/functions/coach-review/index.ts`): pass the **expanded** `ao_codes` / `knowledge_outcomes` / `learning_outcomes` arrays into `compactQuestions`, and add a sentence to the system prompt: "The tag arrays you receive include both teacher-confirmed tags and LO/KO statements that the stem text demonstrably exercises. Treat both as covered."
- Share the matcher logic between client and edge by putting the pure function in `src/lib/coverage-infer.ts` and re-exporting / duplicating the same logic in the edge function (Deno can't import from `src/`, so a small mirror file is acceptable — keep both files in sync via a comment header).

## Files to change

- `supabase/functions/generate-assessment/index.ts` — tighten tagging prompt + tool-schema descriptions; call the new enrichment pass before insert.
- `supabase/functions/generate-assessment/coverage-infer.ts` *(new)* — semantic LO/KO/AO matcher used during generation.
- `supabase/functions/coach-review/index.ts` — expand tags in `compactQuestions`; nudge the system prompt.
- `src/lib/coverage-infer.ts` *(new)* — same matcher for the front-end.
- `src/routes/assessment.$id.tsx` — use the matcher inside `computeCoverage` to expand tag sets before the `.includes` / `covered` checks.

## What stays the same

- The "tags" shown on each question card stay as the saved values (we don't pollute the visible tags with inferred ones — only the coverage rollup is expanded).
- AO weighting/target maths is unchanged; only the actual-mark side picks up extra credit when an inferred AO matches.
- No DB schema changes.

## Out of scope

- Re-running the generator on existing papers. Existing papers will benefit immediately from the UI/Coach enrichment; only newly generated questions get the stronger LLM tags.
