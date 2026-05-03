## Goal

Three fixes scoped to Combined Humanities **Social Studies (Paper 1, 2260/2261/2262)**, in line with how SEAB actually structures the paper and the memory rule that SS case studies can be global/international.

---

## 1. Skills Outcomes (SO) visible & expandable in the builder

**Problem.** `LOGroupedSelector` only renders LOs that live under a topic. SS Paper 1 topics carry no LOs (only SOs at the paper level), so the SO list is silently dropped and the box appears empty.

**Fix in `src/routes/new.tsx`:**

- When `usingSoFallback` is true, render a dedicated, collapsible **"Skills Outcomes"** group above (or instead of) `LOGroupedSelector`, listing every `${code}: ${statement}` from `availableSos` as expandable rows with checkboxes.
- Header shows `selected / total`, with "Select all / Deselect all" plus a chevron toggle (mirroring `LOGroupedSelector`'s topic group UI), defaulting to expanded so people can see what they are.
- Selected SO strings continue to flow into `section.learning_outcomes` (existing wiring) so the generator + coach pick them up unchanged.

---

## 2. SS source pool keeps showing "1 source — skipping"

**Problem.** `curatedHumanitiesSourcePool` only contains History bundles (WWII, Nazis, Stalin, Cold War, Decolonisation). SS topics (citizenship & governance, diverse society, globalised world, bonding, impact of migration, etc.) seed 0, live web fetch times out, and the section dies at the `< 2` floor.

**Fix in `supabase/functions/generate-assessment/index.ts`:**

- Add SS curated bundles, each with 5 distinct-host primary/secondary excerpts so the SBQ pool can hit the 5–6 cap from curated alone (no live fetch dependency). Per the memory rule, sources may be **global/international** as long as the issue maps to the AO/KO/SO theme:
  - **Citizenship & governance** — e.g. Singapore Pledge / Constitution; UK / US citizenship-by-birth debates; Swiss naturalisation case; UN Universal Declaration; comparative governance commentary.
  - **Living in a diverse society** — e.g. Singapore racial-harmony policy; Canadian multiculturalism speech; Quebec religious-symbols law debate; UK Brexit social-cohesion reportage; UNESCO diversity report.
  - **Being part of a globalised world** — e.g. WTO / IMF statements; ASEAN trade agreement excerpt; Brexit / RCEP commentary; UN ILO migrant-worker report; Singapore MTI globalisation speech.
  - **Bonding Singapore / managing tensions** — e.g. NDR speeches on bonding; news report on a bonding initiative abroad (e.g. Australia reconciliation); academic commentary on social trust.
- Each bundle uses 5 different hosts (gov.sg / nas.gov.sg / nlb.gov.sg / un.org / oecd.org / bbc / nytimes / academic.oup.com etc.) so distinct-host seeding fills the pool to 4–5 without live fetches.
- All 5-6 sources should come from different sources, with at least 1 pictorial source. 
- All the sources should come together to talk about an ISSUE, which is what the 5th Source Based question (Assertion/Evaluation) would be about (i.e. how far do the sources agree....). 
- Trigger regexes match SS LO/SO/topic phrasings (e.g. `/(citizenship|governance|civic|national identity)/i`).
- Add SS topic groups to `TOPIC_GROUPS` so SS bundles don't cross-leak into History generation and vice versa.

This alone should produce 5–6 sources per SS SBQ section, including the optional pictorial slot already supported.

---

## 3. SS Section B is SRQ (7+8m), not History two-factor essays

**Problem.** Humanities + `question_type === "long"` is routed to `HISTORY_ESSAY_*` (two-factor "How far …", 9–10 mark scheme, model essay). SS Paper 1 Section B is **Structured Response Questions**: 15 marks split as part (a) **7 marks** + part (b) **8 marks**, asking for explanation + evaluative judgement on an SS issue.

**Fix in `supabase/functions/generate-assessment/index.ts`:**

- Detect SS via `subject` ("Social Studies") OR section context (paper component name / syllabus code 2260/2261/2262 Paper 1). Pass `isSocialStudies` from the caller (pull from `assessment.subject` / paper meta).
- Branch the humanities `long` path:
  - **History** → existing `HISTORY_ESSAY_MARK_SCHEME` + `HISTORY_ESSAY_ANSWER_TEMPLATE` (untouched).
  - **Social Studies** → new `SS_SRQ_MARK_SCHEME` + `SS_SRQ_ANSWER_TEMPLATE`:
    - Part (a) **7 marks** — "Explain two reasons why …" / "Explain two challenges of …": L1 Describe (1–2), L2 One reason explained (3–5), L3 Two reasons explained (6–7)
    - Part (b) **8 marks** — "How far do you agree …" / "Do you think … is the most effective way to …? Explain your answer.": L1 Describe (1–2), L2 One-sided explanation (3–4), L3 Two-sided explanation (5–6), L4 Two-sided + reasoned overall judgement (7–8).
    - Stems must use SEAB SS command words ("Explain …", "How far do you agree that …", "Do you think …") and never the History two-factor "How far X, rather than Y …" template.
    - Answer field = full prose model response (~250–400 words) with concrete contemporary or comparative examples; the example may be **global/international** as long as it serves the AO/KO/SO.
- Force `section.num_questions === 2` and **lock marks to [7, 8]** via `normalizeSectionMarks` lockedIndices when SS SRQ is detected, so the pair always lands on 7+8 regardless of what the model returns.

---

## Files touched

- `src/routes/new.tsx` — collapsible SO group when `usingSoFallback`.
- `supabase/functions/generate-assessment/index.ts` — SS curated bundles, SS topic groups, `isSocialStudies` plumbing, SS SRQ prompt block, locked 7+8 mark distribution.

## Out of scope

- No schema changes.
- No changes to History essays, MCQ, or non-humanities subjects.
- Coach prompts already inject syllabus narrative + AO/KO/SO; no changes needed there for this round.