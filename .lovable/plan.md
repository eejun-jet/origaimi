# Fix History SBQ: missing sources + LO-pasted stems

Looking at the saved "History Mock Up" assessment, two distinct bugs are interacting:

**Bug A — Only "Source A" exists.** The Sources A–E pool was supposed to hold 5 sources, but only 1 made it through. Result: every sub-question references "Source A" and the comparison stem absurdly says "Sources A and A".

**Bug B — Stems paste the Learning Outcome verbatim.** The deterministic SBQ builder substitutes `{T}` (topic) into stem templates, but the "topic" stored is the entire syllabus directive — `"3 · Examine the rise of authoritarian regimes (Nazi Germany) and evaluate the roles of key players in the establishment of authoritarian rule."` — so we end up with stems like *"How far did the developments in 3 · Examine the rise of authoritarian regimes…shape the issue being studied?"*. That violates the rule that KOs/LOs should be tested *through* analytical questions, not handed back as the question.

## What to change

### 1. Guarantee a 5–6 source pool (`generate-assessment/index.ts`)

The SBQ pool target is 5, but live web fetches frequently return `null` within the 14s per-fetch budget, and the curated WWII/appeasement fallback regex doesn't match the topics actually selected (Nazi rise, Cold War, decolonisation, etc.). Fix in three layers:

- **Expand the curated humanities pool** (`curatedHumanitiesSourcePool`) with primary-source bundles for the topics we actually see in MOE Sec History:
  - Rise of Nazism / Weimar Germany (Reichstag Fire decree, Enabling Act, Mein Kampf excerpts, Hindenburg's appointment notice)
  - Stalinist USSR (Five-Year Plan speeches, purge testimony)
  - Cold War origins (Long Telegram, Truman Doctrine, Marshall Plan speech, Zhdanov Doctrine)
  - End of the Cold War (Gorbachev's perestroika address, Reagan's "Tear down this wall", fall-of-the-Wall reportage)
  - Decolonisation in Southeast Asia / Singapore independence (Lee Kuan Yew speeches, Separation Agreement)
  Each entry includes verbatim excerpt, archival URL (yale avalon, UK National Archives, NSA archive, NAS Singapore, USHMM), title, publisher.
- **Topic-aware regex matching** instead of one giant alternation: derive a topic-keyword set from `topic + learning_outcomes` and match against multiple themed source-bundles, returning whichever matches.
- **Backfill loop after parallel fetch**: after the `Promise.all` for live fetches, if `sharedSourcePool.length < 5`, top up from the curated pool by topic match (skipping any URL already in `usedUrls`) until length ≥ 5 or we exhaust the curated pool. This guarantees the pool *never* drops below 5 for supported topics, regardless of crawler luck.
- **Pool-size assertion before deterministic build**: if pool length is still < 2 (e.g. exotic topic, no curated match, all crawls failed), drop the section with a clearer error so we don't emit a paper saying "Sources A and A". Today it silently builds 5 questions all pointing at the same source.

### 2. Rewrite the SBQ stem renderer to use an *inquiry*, not the LO (`buildDeterministicSbqQuestions`)

The current builder uses the raw topic string for `{T}`. Replace with a clean derivation:

- **Build `cleanTopic`** by stripping leading numeric/alpha codes (`/^[\d\.\w]+\s*·\s*/`), trimming, and lower-casing the first word so it reads naturally inside a sentence ("Nazi Germany" stays capitalised; "examine the rise of…" gets reduced — see next point).
- **Detect directive-style topic titles** (start with command words like Examine / Analyse / Evaluate / Assess / Discuss / Explain). When detected, the topic *is* the LO, so we can't use it as `{T}` directly. Instead derive a noun-phrase subject from it by:
  1. dropping the leading command word and any "and evaluate / and explain" tail,
  2. extracting the parenthetical scope if present ("(Nazi Germany)" → "Nazi Germany") OR the head noun phrase before the next verb.
  This is a small string transformation, not an AI call. Result: `"the rise of authoritarian regimes in Nazi Germany"` or `"Nazi Germany"`.
- **Build a real inquiry question** from the SBQ skill set + topic, *not* the templated `"How far did the developments in {T} shape the issue being studied?"` line we have now. Use the SEAB-style question stems already documented in the SBQ_SKILLS prompts:
  - Cause: *"Why did {T} happen / develop / succeed / fail?"*
  - Significance: *"How significant was {T} in shaping {era}?"*
  - Hypothesis (paired with the assertion sub-part): *"How far was {T} caused / shaped mainly by {factor}?"*
  Pick deterministically from the assigned skill mix so the inquiry fits the assertion sub-part below it.
- **Tighten the per-skill templates** so `{T}` is always inserted as a concise noun phrase, never a directive. Add a guard inside `buildDeterministicSbqQuestions` that asserts `cleanTopic` doesn't start with a command word; if it does, fall back to the noun-phrase extractor above before substituting.

### 3. Tighten the AI-generated SBQ path too

For non-deterministic SBQ generation (when present), augment `buildSectionUserPrompt` with an explicit anti-pattern instruction near the LO objectives block:

> The Learning Outcomes listed are what the student must DEMONSTRATE through their answer. They are NOT question stems. Do NOT copy any LO into a question stem verbatim. Each sub-part must be an *analytical inquiry* that requires the student to use the source(s) to reason toward an answer that *evidences* one or more LOs.

Also add: *"Question stems MUST start with a command word from the SEAB AO3 list (Study, Compare, How far, Why, To what extent, How useful, How reliable). They MUST NOT start with directive verbs from the LO statements (Examine, Evaluate, Analyse, Assess, Discuss)."*

### 4. Reset the broken assessment so the user can regenerate

Delete the 7 questions from `84114f3a-1cca-4917-a8e9-23c7cd3c2a16` and reset its status to `draft` so the user can re-run generation against the fixed function.

## Verification

- Curl the regenerated assessment via `supabase--curl_edge_functions` and inspect that:
  - the SBQ section's questions list `Source A:` through at least `Source E:` in a single concatenated `source_excerpt`,
  - sub-part stems reference distinct sources (`A`, `B`, `C`, `A & B`, `A–E`),
  - no stem contains the substring "Examine the rise" or any other directive copied from the LO,
  - mark sum still equals the section budget.
- Spot-check edge-function logs for `[generate] section … SBQ pool: N sources` showing N ≥ 5.

## Files

- `supabase/functions/generate-assessment/index.ts` — expand `curatedHumanitiesSourcePool`, add backfill loop, harden `buildDeterministicSbqQuestions` with topic cleaning + inquiry derivation, add anti-LO-paste instructions in `buildSectionUserPrompt`, abort cleanly if pool < 2.
- DB cleanup migration (or transient query through migration tool) to reset the failed assessment.

No frontend changes required.
