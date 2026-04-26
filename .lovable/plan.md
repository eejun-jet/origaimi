## Goal

Make the AO / LO / KO coverage checker treat content from the **L4 sample answer** and **mark scheme** as first-class evidence that an LO/KO/AO is being tested. Now that every SBQ part and every essay carries a substantial sample answer, an LO the student must deploy to write that answer counts as covered — even when the bare stem doesn't name it explicitly.

This stops the false "uncovered" warnings the user is seeing.

## Where the change lives

The matcher is in three near-duplicate files (one for the React app, two for Deno edge functions, which can't import from `src/`):

- `src/lib/coverage-infer.ts` (Coverage panel in `src/routes/assessment.$id.tsx`)
- `supabase/functions/coach-review/coverage-infer.ts` (input to the Coach LLM)
- `supabase/functions/generate-assessment/coverage-infer.ts` (post-pass before insert)

All three already concatenate `stem + answer + mark_scheme + topic + options` into the matching text. So the fix is purely about *thresholds and verb lists*, not call sites — keep all three in sync with identical content.

## Changes to `coverage-infer.ts` (×3)

### 1. LO matcher — context-sensitive threshold

Currently a question matches an LO when ≥60% of the LO's content tokens (stemmed) appear in the supporting text, AND every proper-noun token in the LO appears verbatim. This is too strict once the sample answer gets long.

- Detect "rich support": the supporting text has ≥60 content tokens (i.e. the question carries a real sample answer / mark scheme, not just a stem).
- Drop the LO-token threshold from **60% → 40%** when support is rich.
- For short LOs (≤3 content tokens, currently require ALL): also accept **2-of-3** when support is rich.
- Soften the proper-noun gate: instead of requiring EVERY named entity in the LO, require **≥ ceil(N/2)** of them. Single-name LOs still require that one name (otherwise the question really is about a different topic).

### 2. KO inference — broader verb pool + factual-recall heuristic

Add verbs that surface in L4 sample answers and SBQ mark schemes:

- **Understanding**: + "account for", "suggest", "imply", "reveal", "indicate"
- **Application**: + "draw on contextual" (matches "draw on your contextual knowledge")
- **Skills**: + "cross-reference", "weighing", "balanced judgement", "reasoned judgement", "provenance", "bias", "motive", "limitations"

Fix the matcher so multi-word verbs (e.g. "account for", "show that") use substring match, not the existing single-word boundary match (which silently misses them today).

Add a **Knowledge fold-in**: if the supporting text contains ≥2 four-digit year tokens (1500–2099) OR ≥6 capitalised proper nouns, treat **Knowledge** as engaged when it's in the pool. This catches essays / SBQ answers that visibly demonstrate factual recall without using a "state/name/list" verb.

### 3. AO inference — broader verb pool + cascade rules

Expand the humanities AO pool to include verbs the L4 sample answer naturally uses:

- **AO1**: + "outline", "recount"
- **AO2**: + "suggest", "imply", "reveal"
- **AO3**: + "evaluate", "assess", "judgement / judgment", "provenance", "bias", "motive", "limitation", "cross-reference", "weighing", "weigh"

Add two cascade rules:

- For humanities, when AO3 fires AND AO2 is in the pool → also add AO2 (you cannot evaluate without explaining).
- When the supporting text shows ≥2 year tokens OR ≥6 proper nouns AND AO1 is in the pool → also add AO1 (factual-recall demonstration).

### 4. Comment update

Update the file header comment to spell out: "now that every SBQ + essay carries a substantial L4 sample answer, content the student would have to deploy to write that answer is treated as evidence the LO is being tested."

## Non-goals / kept as-is

- No DB / schema change.
- No change to the call sites in `src/routes/assessment.$id.tsx` or `supabase/functions/coach-review/index.ts` — they already pass `answer` and `mark_scheme` into the matcher.
- The matcher is still **additive only** — it never removes a tag the LLM or the teacher set.
- After updating the two Deno copies, redeploy `coach-review` and `generate-assessment`.

## Acceptance

- Re-opening an existing History paper's Coverage panel shows fewer false "uncovered" LO/KO/AO warnings, because LOs the sample answer demonstrably engages now register as covered.
- Newly generated papers run the same expanded matcher in the post-pass, so the saved `learning_outcomes` / `knowledge_outcomes` / `ao_codes` arrays are more complete from the start.
- The Coach LLM receives the same expanded tags, so its AO drift / KO balance checks reflect what the answer actually tests.