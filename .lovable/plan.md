## Problem

For both Social Studies and History SBQ papers, students need a short (1-paragraph) write-up that contextualises the issue derived from the KO/LO BEFORE they read the sources. The most recent SS paper had no such write-up, and the sources didn't visibly align to the inquiry question — they read like a generic dump on the topic rather than evidence on the specific sub-issue.

## What to build

### 1. Add a `contextWriteUp` field to every curated humanities bundle
File: `supabase/functions/generate-assessment/index.ts`

- Extend `CuratedBundle` (History, line ~425) and the SS bundle type (line ~561) with a required `contextWriteUp: string` field (~80–120 words).
- Extend `SbqInquiryBundle` (line ~992) with `contextWriteUp: string` so it flows alongside `subIssue / inquiryQuestion / assertion`.
- Author one paragraph per bundle that:
  - Names the KO/LO the section is testing in plain language.
  - States the real-world tension the inquiry question hinges on (e.g. for "How far are foreign immigrants able to integrate into Singapore's way of life?" — note the post-2010 inflow, CMIO framework, points of friction like housing/transport/national service, and government integration efforts).
  - Ends by pointing students to the inquiry question + sources.
- 8 SS bundles + 7 History bundles = 15 paragraphs to author.

### 2. Surface the write-up on the section
- In `generate-assessment/index.ts` where the section is emitted (around the `saveSection` / question persistence near line ~2400), attach the bundle's `contextWriteUp` as `section.intro` (new optional string column on `assessment_sections`) OR — to avoid a migration — stash it as the first line of the first question's `notes` with a `[SECTION_CONTEXT]` sentinel.
- Recommended: add `intro text` to `assessment_sections` via migration; cleaner contract.

### 3. Lock sources to the issue (alignment fix)
File: `supabase/functions/generate-assessment/index.ts` (section A seeding, ~2120–2180)

- When a curated bundle is matched, the 5 curated sources already align — but the live backfill path can pull off-topic material. Tighten:
  - Pass `bundle.subIssue + bundle.inquiryQuestion` (not just the topic noun) as the Tavily query when backfilling.
  - Reject any backfill candidate whose extract does not contain at least one bundle keyword (derived from `subIssue` + `inquiryQuestion`, stop-words stripped).
  - Log `[generate] section A: rejected backfill X — off-issue` so we can audit.
- If after rejection the pool is < 4 sources, prefer fewer-but-aligned over more-but-drifted (current code already tolerates 4).
- The pictorial fetch query is already scoped to `sectionBundle.subIssue` — verify it stays that way.

### 4. Render the write-up in the assessment view
File: `src/routes/assessment.$id.tsx` (around line 1075, just above the "Sources for this section" card)

- Read `sec.intro` (or parse the sentinel out of the first question's notes).
- Render a new panel above the sources block:
  - Label: "Background to this issue"
  - Body: the paragraph, font-paper, muted border.
  - Followed (italicised) by: "Key inquiry question: {inquiryQuestion}"

### 5. Include the write-up in exports
Files: `src/lib/export-tos-docx.ts` (and the paper export pathway, not the ToS)

- Verify which export file produces the actual paper DOCX (likely `src/lib/export-docx.ts`).
- For each SBQ section, emit the contextual paragraph + inquiry question as a styled block immediately after the section header and before "Sources for this section".

## Verification

1. Generate a fresh Combined Humanities SS paper on Issue 2 (Diversity) whose KO matches the "foreign immigrants integration" bundle. Expected:
   - Section A opens with the new write-up paragraph naming CMIO, integration policies, and points of friction.
   - The inquiry question appears verbatim.
   - All 5 sources visibly reference foreign-born residents / integration / new citizens — not generic "diversity" material.
2. Generate a History SBQ on Cold War. Expected:
   - Write-up paragraph on US–USSR origins of the Cold War, naming Truman Doctrine / Marshall Plan / Berlin.
   - Sources all bear on US responsibility specifically.
3. Inspect edge function logs for `[generate] section A: rejected backfill` lines — confirms the off-issue filter is firing when live backfill triggers.
4. DOCX export contains the write-up paragraph above the sources for each SBQ section.

## Out of scope

- No change to non-humanities sections.
- No new bundles (the 8 SS + 7 History bundles already added in the previous turn remain the set; we only add `contextWriteUp` to each).
- No change to the deterministic question builder's stems — those already use the bundle's inquiry question and assertion verbatim.
