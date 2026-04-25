## Goals

Two distinct improvements to assessment generation:

1. **History/Social Studies sources** — strongly prefer **primary sources**; allow scholar perspectives & historiography only **sparingly** (cap at ~1 of N sources in any SBQ pool).
2. **Mark cap (all subjects)** — guarantee that the sum of `marks` across generated questions in a section never exceeds the section's declared mark allocation.

---

## 1. Bias source pool toward primary sources

**File:** `supabase/functions/generate-assessment/sources.ts`

Currently the humanities query chain alternates 1:1 between `primary source document` and `historian analysis / perspective` queries, and Tier 2 (JSTOR / HistoryToday / HistoryExtra / Oxford / Britannica) URLs are merely sorted after Tier 1 — they're still freely picked when Tier 1 yields nothing for that *single* fetch.

Changes:

- **Re-weight the query chain (`buildQueryChain`)**: emit ~4 primary-source queries for every 1 historian-perspective query. Replace the alternating pair with: `primary source document archive`, `archival document`, `contemporary newspaper account`, `speech treaty official record`, then a single `historian analysis` query as the last specific query (still ahead of broader fallbacks).
- **Add a per-pool cap on Tier-2 (scholar/historiography) sources** in `fetchGroundedSource`. New optional param `tierBudget?: { tier2Used: number; maxTier2: number }`. When `tier2Used >= maxTier2`, candidate URLs whose `humanitiesTier(host) === 2` are filtered out before scrape.
- **Demote Britannica** from Tier 2 to Tier 3 (it's a tertiary reference, not a historian's perspective). Keep JSTOR / HistoryToday / HistoryExtra / OxfordRE in Tier 2.
- **Add more primary-source domains** to `ALLOW_DOMAINS_HUMANITIES` and `HUMANITIES_TIER_1_PRIMARY`: `parliament.uk`, `hansard.parliament.uk`, `digitalarchive.wilsoncenter.org`, `cvce.eu`, `marxists.org` (for primary political texts), `digital.library.cornell.edu`, `cia.gov/readingroom`, `state.gov/historicaldocuments`, `nara.gov`. Allow all .edu, .org and .gov sites. 

**File:** `supabase/functions/generate-assessment/index.ts`

- Where the SBQ pool is built (the loop that calls `fetchGroundedSource` ~5–6 times), pass a shared `tierBudget` object with `maxTier2 = 1` (so at most 1 of the 5–6 sources can be a scholar/historiography piece). Increment `tier2Used` whenever the returned source's host is Tier 2.

---

## 2. Enforce mark cap per section (all subjects)

Today the model is *told* the section's mark budget (`marksGuide` at line ~525) and `marks: q.marks ?? 1` is trusted from the model output. Nothing prevents the model from emitting questions whose marks sum beyond `section.marks`.

**File:** `supabase/functions/generate-assessment/index.ts`

- After the model returns questions for a section (and after the SBQ deterministic builder, which is already exact), add a `normalizeSectionMarks(questions, section.marks)` helper that:
  1. If `sum(marks) === section.marks`: no-op.
  2. If `sum(marks) > section.marks`: scale each question's marks proportionally (`floor`), then distribute leftover (or negative leftover) by removing 1 mark at a time from the highest-mark questions until the total matches. Never let any question drop below 1 mark — if the section's mark budget is smaller than `num_questions`, log a warning and clamp at 1 each (this is a malformed blueprint case).
  3. If `sum(marks) < section.marks`: distribute the shortfall by adding 1 mark at a time to the lowest-mark questions (preserving the model's relative weighting).
  4. **Respect locked SBQ skills** (`assertion` is locked at 8): pass a `lockedIndices` set so those marks are never altered; balance the rest around them. If locked marks alone exceed `section.marks`, log a warning and skip normalization for this section (blueprint mismatch).
- Call `normalizeSectionMarks` immediately after parsing the AI tool-call response, before pushing into `allRows`. Apply to every question_type, not just SBQ.
- Tighten the prompt: add a hard line in `buildSectionPrompt` after `marksGuide`: `HARD CONSTRAINT: the sum of marks across the ${num_questions} questions MUST equal exactly ${section.marks}. Do not exceed it under any circumstances.`

---

## Technical summary


| File                                                | Change                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/generate-assessment/sources.ts` | Reweight `buildQueryChain` (4:1 primary:historian), add Tier-2 budget to `fetchGroundedSource`, demote Britannica to Tier 3, expand Tier-1 allow-list with parliament/state/CIA archives |
| `supabase/functions/generate-assessment/index.ts`   | Pass shared `tierBudget = { tier2Used: 0, maxTier2: 1 }` to SBQ pool fetches; add `normalizeSectionMarks()` post-processor; add HARD CONSTRAINT line to section prompt                   |


No DB migrations, no new edge functions, no UI changes. Single edge-function deploy of `generate-assessment`.