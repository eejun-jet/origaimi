## What went wrong on this SS Test run

You typed:

> "i want a topic on the SBQ case study to be about serving NAtional Service and Singapore identity, and Citizenship roles and responsibilities"

Two distinct bugs combined:

### Bug 1 — Your raw note was pasted verbatim as the SBQ background
In `supabase/functions/generate-assessment/index.ts` (~line 2683), when a teacher focus is present we currently prepend `Teacher focus: <full instructions text>.` directly into the `[CONTEXT]…[/CONTEXT]` envelope that students read on the paper. So your sentence — typos, "i want a topic on the SBQ…", and all — ended up as the first line of the case-study background. That's wrong: teacher instructions are a *brief* to the generator, not student-facing text.

### Bug 2 — The sources didn't fit, because there is no NS bundle
The SS focus-matching logic in `pickSsSubIssueBundle()` (~line 725) tokenises your focus and scores it against every curated bundle. With "national identity" and "citizenship" as strong tokens, the scorer locked onto the **HDB / Singaporean national identity** bundle (lines 595–609) because the words *citizenship* and *national identity* appear all over its excerpts. But you actually asked about **National Service** — and there is **no NS curated bundle in `SS_SUB_ISSUE_BUNDLES`** at all. So the focus "matched" a thematically adjacent but materially wrong case (HDB), and Q1–Q5 ended up interrogating million-dollar flats instead of NS.

Compounding this, the current threshold (`best.s >= 2`) is too loose. Any 2 incidental keyword overlaps marks the run as `focusMatched=true`, so even the "focus didn't match" UI banner never fired.

## Plan

### 1. Add a National Service bundle (`SS_SUB_ISSUE_BUNDLES`, Issue 1)
New bundle:
- `subIssue`: "National Service and Singaporean citizenship"
- `inquiryQuestion`: "How far has National Service shaped what it means to be a Singaporean citizen?"
- `assertion`: "National Service is the single most important experience binding Singaporean men to their citizenship."
- `triggers`: `/(national service|\bns\b|nsf|nsmen|conscription|enlistment|mindef|saf|reservist|ict|citizen soldier|pr.{0,15}(ns|service)|exempt.{0,15}(ns|service))/i`
- `contextWriteUp`: ~120-word paragraph framing NS Act 1967 → 2½-year full-time service → reservist cycle → debates over PR/new-citizen liability, gender, and identity formation. Tied to Issue 1 KO/AO1+AO2.
- 5 curated sources, each on the SAME tension (NS and citizenship):
  1. MINDEF "Why we serve" — official rationale + NS Act 1967 history (mindef.gov.sg)
  2. PM/parliamentary speech reaffirming NS as a "rite of citizenship" (PMO.gov.sg / parliament Hansard excerpt)
  3. IPS or CNA commentary on NS and male Singaporean identity (channelnewsasia.com or lkyspp)
  4. Parliamentary reply on PR sons and NS liability — the perceived-fairness dimension (parliament.gov.sg)
  5. Counter-perspective: academic/CNA piece on women, new citizens and unequal access to the "NS bonding" experience

### 2. Stop printing teacher's raw text into the student-facing background
Replace the `focusSentence` block (~lines 2683–2691):
- Remove `Teacher focus: <ssFocusRequested>.` from the `[CONTEXT]` envelope entirely. Students should only ever see the curated `contextWriteUp`.
- Remove the "Note: this paper falls back to the curated case on …" line from the printed context as well. Teachers should not see meta-text *inside* the student paper either.
- Both pieces of information move to the existing `notes` field on Q1 (already wired). The UI already renders `SS_FOCUS_FALLBACK::…` as an inline teacher-facing banner on the assessment view — that is the right place for "your focus didn't match".

### 3. Tighten focus-match threshold so HDB stops absorbing NS prompts
In `pickSsSubIssueBundle()` (~lines 760–805):
- Require either (a) the bundle's `triggers` regex matches the cleanFocus directly (`score >= 5` in current scoring), or (b) at least **3** distinct keyword overlaps **and** the top-scoring bundle's lead margin over the runner-up is **≥ 2**. Otherwise treat as fallback.
- Expand the stopword list to also drop generic SBQ vocabulary that bias scoring toward HDB/civic bundles when the real subject is something else: `topic`, `case`, `study`, `serving`, `roles`, `responsibilities`, `identity`, `citizenship`. (These are too generic — if they're the *only* overlap they shouldn't pick a bundle. With the NS bundle in place, the *specific* tokens "national" + "service" / "ns" will drive selection correctly via the trigger regex.)
- When fallback is taken, log the top 3 scored bundles + their scores so we can debug future misfires from edge logs.

### 4. Verification
1. Regenerate "SS Test 4" with a note about National Service → SBQ uses the new NS bundle (trigger regex hits `national service`), background reads as a clean NS framing paragraph, no teacher-text bleed.
2. Generate with "HDB and Singaporean identity" → still hits the HDB bundle (existing trigger still wins).
3. Generate with "quantum computing" → top score < threshold → fallback to hash, UI banner fires, edge log records the top-3 scored bundles.
4. Inspect the generated paper view: verify the `[CONTEXT]` block contains ONLY the curated paragraph, and the inline teacher banner (yellow notice) appears only when fallback occurred.

### Out of scope
- No change to History SBQ.
- No live AI synthesis of bundles. We stay on the deterministic curated path; the fix is (a) cover the missing NS case, (b) stop dumping raw instructions into the student paper, (c) make false-positive matches less likely.

### Files touched
- `supabase/functions/generate-assessment/index.ts` — add NS bundle, tighten `pickSsSubIssueBundle`, remove focus text from `[CONTEXT]` envelope, keep `notes` flag for UI banner.
- No client changes required (UI banner is already wired).
