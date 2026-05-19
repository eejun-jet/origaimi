## Goal

Stop SS Section B SRQ stems from concatenating the syllabus **strand prefix** (e.g. `"Exploring Citizenship and Governance: "`) and the raw KO/LO sentence verbatim into the question. The stem should read as a clean issue phrase, not as the syllabus row label.

Two real examples from the user:

- ❌ `Explain two reasons why exploring Citizenship and Governance: different attributes can shape one's understanding of citizenship can create challenges for society.`
- ✅ `Explain two reasons why different attributes shaping one's understanding of citizenship can create challenges for society.`

- ❌ `How far do you agree that government action is the most effective way to respond to exploring Citizenship and Governance: different attributes can shape one's understanding of citizenship? Explain your answer.`
- ✅ `How far do you agree that government action is the most effective way to respond to different attributes shaping one's understanding of citizenship? Explain your answer.`

## Where it comes from

`buildDeterministicSsSrqQuestions` (index.ts ~L1274) takes `section.topic_pool[0].topic` and runs it through `deriveTopicNoun` (~L1071). For SS the topic string is often shaped like `"<Strand>: <KO/LO clause>"` (e.g. `"Exploring Citizenship and Governance: different attributes can shape one's understanding of citizenship"`). `deriveTopicNoun` was tuned for History titles (verb-led directives) and does not strip:

1. A leading `"<Strand words>:"` prefix.
2. Modal/clause forms like `"<X> can <verb> <Y>"` that don't slot grammatically into `"reasons why … can create challenges"` or `"respond to …"`.

The same raw topic is also passed into the LLM SRQ prompt block (~L1762), so the model copies the same ugly phrasing.

## Changes to `supabase/functions/generate-assessment/index.ts`

1. **Add `deriveSsIssuePhrase(rawTopic, learningOutcomes)`** — SS-specific cleaner used by both the deterministic SRQ builder and the LLM SRQ prompt:
   - Strip a leading strand prefix when the topic contains `:` and the left side matches a known SS strand stem (`Exploring Citizenship and Governance`, `Living in a Diverse Society`, `Being Part of a Globalised World`, plus a generic 2–6 word title-case fallback ending in `:`). Keep only the right-hand clause.
   - Lowercase the first word unless it's a proper noun (reuse the existing proper-noun guard).
   - Rewrite `"<subject> can <verb> <object>"` → `"<subject> <verb>ing <object>"` so the phrase reads as a noun phrase (e.g. `"different attributes can shape one's understanding of citizenship"` → `"different attributes shaping one's understanding of citizenship"`). Handle the common verbs `shape, affect, influence, create, cause, drive, lead, support, undermine, challenge, strengthen, weaken, threaten` — leave the phrase untouched if no rule matches (safer than mangling).
   - Strip trailing punctuation, collapse whitespace, cap at ~14 words.
   - Fallback to `deriveTopicNoun` output if the cleaned string ends up empty.

2. **Use it in `buildDeterministicSsSrqQuestions`** (~L1277): replace `const issue = deriveTopicNoun(...)` with `const issue = deriveSsIssuePhrase(...)`. The two stems at L1293 / L1306 then read cleanly. `topicTag` (used for tagging, not the stem) keeps the original strand label so reporting/coverage is unaffected.

3. **Use it in the SS SRQ LLM prompt** (~L1762 `ssStructuredBlock`): pass the cleaned issue phrase into the prompt and add one explicit instruction:
   > "When NAMING the SS issue in the stem, use the cleaned issue phrase provided below. Do NOT prefix it with the syllabus strand label (e.g. 'Exploring Citizenship and Governance:') and do NOT paste the raw KO/LO sentence verbatim. Rephrase modal clauses ('X can shape Y') as noun phrases ('X shaping Y') so the stem reads grammatically after 'reasons why …' or 'respond to …'."

   Also surface the cleaned phrase in the prompt as `ISSUE PHRASE TO USE IN STEMS: "<phrase>"`.

4. **No change** to History SRQ/essay phrasing, to SBQ source bundles, to AOs/KOs/LOs, to mark schemes, or to UI.

## Verification

1. Re-run an SS paper whose Section B targets `Exploring Citizenship and Governance > different attributes can shape one's understanding of citizenship`. Confirm both stems match the ✅ examples above.
2. Re-run an SS paper on `Living in a Diverse Society > responding to differences and tensions in a diverse society` — confirm the strand prefix is dropped and the modal-clause rewrite still produces a readable stem.
3. Re-run an SS paper on `Being Part of a Globalised World > globalisation creates economic, cultural and security impacts` — confirm both deterministic and LLM paths emit clean stems.
4. Spot-check a History paper (e.g. Cold War) — `deriveTopicNoun` path is unchanged, History essay stems must read identically to before.

## Out of scope

- No change to History question stems or builders.
- No change to SBQ phrasing, source bundles, perspective rule, or `[CONTEXT]` envelope.
- No DB / schema / UI changes.

## Files touched

- `supabase/functions/generate-assessment/index.ts` — add `deriveSsIssuePhrase`, swap it into the deterministic SS SRQ builder, thread it into the SS SRQ LLM prompt block.
- (No memory update — this is a phrasing fix, not a new product rule.)
