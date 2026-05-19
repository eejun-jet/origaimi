## What's wrong

Two real bugs in `supabase/functions/generate-assessment/index.ts` + `sources.ts`.

### Bug 1 — the "Background to this issue" writeup is silently dropped

`SbqInquiryBundle` requires `contextWriteUp: string` (L1221–1226), but the section-level value `sectionBundleForSection` is constructed WITHOUT it:

- L2353–2357 (SS path): `{ subIssue, inquiryQuestion, assertion }` — no `contextWriteUp`.
- L2369–2373 (History path): same omission.

Then at L2835 the renderer reads `sectionBundleForSection?.contextWriteUp`, gets `undefined`, and `baseContext` becomes `""`. With `baseContext` empty, the `[CONTEXT]…[/CONTEXT]` envelope is skipped entirely (L2844–2846), so the printed paper has no "Background to this issue" block at all. That's why the user can't see the writeup on SS Test 7.

### Bug 2 — pictorial sources don't align to the case study

`fetchGroundedImageSources` (sources.ts L889–1019) is called with `subIssue` + `inquiryQuestion` + `assertion`, but:

1. It runs THREE passes: `strict` (allow-list + positive keyword score), `relaxed` (allow-list + score > -3), and `final` (NO allow-list, score > -3). Once `strict` returns nothing, `relaxed`/`final` accept images that have ZERO topic-keyword overlap — anything that isn't obviously a logo. That's how off-topic pictures slip in.
2. The query angles are hard-coded to History tropes (`political cartoon`, `propaganda poster`, `historical photograph`) — fine for History SBQ, wrong genre for SS case studies on housing / NS / migrant workers, where the natural pictorial primaries are photographs, infographics, news photos, charts.
3. Keyword extraction sees only `subIssue` + `inquiryQuestion` + `assertion` — never the rich `contextWriteUp`, which is the densest source of issue-specific nouns ("HDB", "BTO", "Ethnic Integration Policy", "Speakers' Corner", etc.). So scoring under-weights real topic matches.

## Plan

Both bugs, one file change each (plus a small index.ts wiring change for #2).

### Fix 1 — propagate `contextWriteUp` to the section bundle

In `index.ts`:

- L2353: add `contextWriteUp: ssSubIssueForSection.contextWriteUp` to the SS-path object literal.
- L2369: add `contextWriteUp: historyBundleForSection.contextWriteUp` to the History-path object literal.

No other change needed — L2835 already reads `.contextWriteUp` and L2844–2846 already wraps it in the `[CONTEXT]…[/CONTEXT]` envelope; both parsers (`src/routes/assessment.$id.tsx` L1473, `src/lib/export-docx.ts` L50) already render it as "Background to this issue".

### Fix 2 — make pictorial sources actually align

Two changes:

**A. `index.ts` (~L2517–2531):** pass the bundle's `contextWriteUp` into the image fetch as additional learning-outcome text, so its issue-specific nouns drive keyword scoring:

```ts
const imageLOs = sectionBundleForSection
  ? [
      sectionBundleForSection.inquiryQuestion,
      sectionBundleForSection.assertion,
      sectionBundleForSection.contextWriteUp,   // NEW — dense issue-specific vocabulary
      ...(sectionTopic.learning_outcomes ?? []),
    ]
  : (sectionTopic.learning_outcomes ?? []);
```

**B. `sources.ts` `fetchGroundedImageSources` (L889–1019):**

1. Drop the `final` pass entirely. Passes become `["strict", "relaxed"]` only — never bypass the humanities allow-list. Better to ship 0–1 image than an unrelated one.
2. Require positive topic-keyword overlap on ALL passes. Change the filter at L983 to: `r.score > 0 && r.kwHits > 0` (track `kwHits` alongside `score` in the rank map). A picture that doesn't match a single issue-specific keyword should never be picked.
3. Broaden query angles for non-History issues. Add SS-friendly angles so we don't only ask for "political cartoon / propaganda poster":
   - `${baseTerms} photograph`
   - `${baseTerms} news photo`
   - `${baseTerms} infographic chart`
   - keep `${baseTerms} political cartoon` and `${baseTerms} propaganda poster` for History
   Cap to the first 4 queries to keep the 9s wall-clock budget intact.
4. Down-rank the meta vocabulary penalty: add `/stock photo|clip ?art|silhouette|illustration of generic/` to the penalty regex at L973 so generic stock images stop scoring positive.

Net effect: the pictorial sources must either come from a tier-1/tier-2 humanities host AND contain at least one topic keyword in their description, or they don't ship at all. The user's complaint about misaligned images is resolved by removing the silent "final" fallback, not by adding more filtering on top of it.

### Verification

1. Regenerate an SS paper on the same sub-issue as "SS Test 7" — confirm the "Background to this issue" block now renders the 5–7 sentence writeup above the sources.
2. Regenerate the same paper twice and inspect both pictorial sources. Each must (a) come from an allow-listed host and (b) have a caption containing at least one issue keyword.
3. Regenerate a History SBQ (e.g. Cold War origins) — confirm writeup still renders AND that pictorial cartoons/posters still come through (the History angles are unchanged).
4. Worst case: if no image passes the stricter filter, the section ships with 4 text sources only — the log line at L2537 (`[pictorial-miss]`) already covers this branch; no UI change needed.

### Out of scope

- No change to `SS_SUB_ISSUE_BUNDLES`, `assertBundlePerspectiveMix`, SRQ/essay generation, mark schemes, DB schema, or UI parsers.
- No change to History bundles' content.
- No change to `MAX_IMAGE_SOURCES` (stays at 2) or `MAX_TOTAL_SOURCES` (stays at 6).

### Files touched

- `supabase/functions/generate-assessment/index.ts` — 2 one-line additions (L2353, L2369), 1 one-line addition to image LOs (~L2521).
- `supabase/functions/generate-assessment/sources.ts` — tighten `fetchGroundedImageSources` passes, queries, and ranking filter.
