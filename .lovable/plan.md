# Anchor every SBQ section on a single KO/LO-driven inquiry question

## What's already there

- **Social Studies** uses `SS_SUB_ISSUE_BUNDLES` (index.ts ~538). Each bundle ships 5 sources + a `subIssue`, `inquiryQuestion`, and `assertion`. The deterministic builder already uses `ssBundle.inquiryQuestion` as the opening line and `ssBundle.assertion` as the Q5 hypothesis.
- **History** uses `CURATED_HUMANITIES_BUNDLES` (index.ts ~425). Each bundle ships sources only — **no `inquiryQuestion`, no `assertion`, no `subIssue`**. The opener falls back to `buildInquiryQuestion(topicNoun, skills)`, which emits a generic skill-shaped stem ("How far was X shaped by the actions of the major actors involved?") with no real argumentative bite, and the LLM prompt at index.ts ~1280 just tells the model to invent a key inquiry on its own.

So the gap is real for History, and for SS we only need one missing sub-issue (the user's "foreign immigrants integrating into Singapore's way of life" example).

## The fix

### 1. Extend the History bundle shape

In `supabase/functions/generate-assessment/index.ts`:

```ts
type CuratedBundle = {
  trigger: RegExp;
  subIssue: string;            // short tag, e.g. "the outbreak of the Korean War"
  inquiryQuestion: string;     // debatable, e.g. "How far was the US responsible for the outbreak of the Korean War?"
  assertion: string;           // testable hypothesis used by the assertion sub-part
  sources: GroundedSource[];
};
```

Author `subIssue` / `inquiryQuestion` / `assertion` for each of the 7 existing History bundles (WWII outbreak, Nazism, Militarist Japan, Stalinist USSR, Cold War origins, end of Cold War, Singapore decolonisation/merger/separation). Each inquiry must be debatable, anchored on a real cause/role/consequence question that the bundle's 5 sources can support AND challenge.

### 2. Expose the winning bundle, not just its sources

Replace `curatedHumanitiesSourcePool(...)` with `pickHumanitiesBundle(...)` that returns `{ bundle: CuratedBundle | null, sources: GroundedSource[] }`, mirroring `pickSsSubIssueBundle`. When multiple bundles match the topic group, pick the highest-specificity match (longest unique trigger hit on the topic string, falling back to LO/KO). Keep the existing topic-group guard so Cold War sources don't leak into a WWII section.

### 3. Generalise the "section bundle" handle

In the SBQ section-assembly block (index.ts ~1889 onwards), replace the SS-only `ssSubIssueForSection: SsSubIssueBundle | null` with a unified `sectionBundle: { subIssue: string; inquiryQuestion: string; assertion: string } | null` populated from EITHER `pickSsSubIssueBundle` (SS) or `pickHumanitiesBundle` (History). Use it for:

- The LLM prompt (`sbqSectionPreamble`, line ~1275): replace the "ONE KEY LINE OF INQUIRY about `${sectionTopic}`" sentence with the explicit `KEY INQUIRY QUESTION: "${sectionBundle.inquiryQuestion}"` plus a rule that EVERY sub-part must investigate this question. Inject `sectionBundle.assertion` directly into the assertion sub-part guidance so the model doesn't paraphrase or invent one.
- The deterministic fallback builder (`buildDeterministicSbqQuestions`, line ~880): pass the unified bundle (instead of the SS-only `ssBundle` arg). Use its `inquiryQuestion` as the opener and its `assertion` as the Q5 hypothesis for both subjects.
- The image-fetch scope (index.ts ~2080): already uses `ssSubIssueForSection.subIssue` as the image topic — extend to use `sectionBundle.subIssue` for History too, so pictorial sources are scoped to e.g. "the outbreak of the Korean War" rather than the broad chapter title.

### 4. Add one missing SS bundle

Add a `SS_SUB_ISSUE_BUNDLES` entry under Issue 2 (Diversity) with:

- `subIssue`: "foreign immigrants and integration into Singaporean way of life"
- `inquiryQuestion`: "How far are foreign immigrants able to integrate into Singapore's way of life?"
- `assertion`: "Singapore's social fabric is being strained by the difficulty of integrating new immigrants."
- `triggers`: `/(foreign immigrant|new citizen|new immigrant|integration|assimilation|naturalisation|naturalization|prc|filipino|indian national|expat)/i`
- 5 curated sources (mix of: ICA / Population White Paper extract, IPS or CNA survey on social acceptance, a SG government press release on integration programmes, an academic/journal excerpt on assimilation barriers, an OECD/global comparator on immigrant integration).

This is the only new content authoring needed; everything else is structural plumbing.

### 5. Tighten the generic fallback

When no curated bundle matches (rare — only for unusual topics), keep the existing `buildInquiryQuestion` fallback, but feed it the KO string when available so the inquiry says e.g. "How far was nationalism responsible for the outbreak of war?" rather than only using the topic noun. Strictly a small upgrade so the fallback path is at least KO-aware.

## What stays out of scope

- No DB / UI changes — this is all inside `supabase/functions/generate-assessment/`.
- Not rewriting the SBQ skill assignment logic (Inference / Comparison / Reliability / Assertion mapping is unchanged).
- Not changing how text + image sources are selected/ranked (the previous pictorial-source fix stands).

## Verification

- Generate a Combined Humanities P1 SS paper whose KO matches the new "foreign immigrants integration" bundle → SBQ opens with that exact inquiry question; Q5 uses its assertion verbatim.
- Generate a History SBQ paper on the Korean War / Cold War origins → SBQ opens with the bundle's explicit `inquiryQuestion`, not the generic "How far was the cold war shaped by the actions of the major actors involved?" template.
- For both, every sub-part stem visibly cites the shared sources A–E and the model answer's reasoning refers back to the inquiry question.
- Edge-function logs include `[generate] section X: bundle "<subIssue>" → "<inquiryQuestion>"` once per SBQ section.
