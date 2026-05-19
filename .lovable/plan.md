## What's wrong

### Problem 1 — total source count drifts below 6

In `supabase/functions/generate-assessment/index.ts` (~L2294, L2423):

```ts
const MAX_TOTAL_SOURCES = 6;
const MAX_IMAGE_SOURCES = 2;
...
const FETCH_TARGET = Math.max(0, MAX_TOTAL_SOURCES - MAX_IMAGE_SOURCES); // = 4
```

`FETCH_TARGET` is fixed at 4 *before* we know how many pictorials will pass the tightened filter. After the pictorial step:

- 2 images found → 4 text + 2 images = 6 ✓
- 1 image found → 4 text + 1 image = 5 ✗
- 0 images found → 4 text + 0 = 4 ✗ (user's "SS Test 9" complaint)

The trim at L2554 (`textCap = MAX_TOTAL - imagesCount`) only ever *caps*; it never tops the text pool back up after a pictorial miss.

### Problem 2 — pictorial alignment is still too loose

In `sources.ts` `fetchGroundedImageSources` (L959–L1001), filtering requires:
- `kwHits > 0` against `topicVocab`
- `descLen >= 60`
- `captionKwHits > 0` against `topicVocab`

`topicVocab` is `syllabusKeywordsFor(topic, learningOutcomes)`. When `imageTopic = sectionBundleForSection.subIssue` (L2520) and the LOs include `inquiryQuestion + assertion + contextWriteUp`, the vocab balloons to dozens of generic terms ("Singapore", "society", "policy", "worker", "national"). A single generic match passes. There is no requirement that the caption mention a *sub-issue-defining* term (e.g. "dormitory", "migrant", "foreign worker", "S Pass"), and no minimum hit count.

The relaxed pass with `score > -3` further widens the door even after strict found nothing aligned.

## Plan

### Fix 1 — always ship 6 sources (when supply allows)

Edit `supabase/functions/generate-assessment/index.ts`:

1. **Fetch text to fill the full cap, not the cap-minus-images.** Change `FETCH_TARGET` (L2423) to `MAX_TOTAL_SOURCES` (= 6). Curated seeding (`CURATED_SEED_CAP = 4`) and curated backfill (L2476–L2509) both already use `poolSize` / `FETCH_TARGET`; raising `FETCH_TARGET` lets them top up to 6 from curated bundles when live fetch and pictorials underdeliver.

2. **Run pictorial fetch BEFORE the final text trim, then trim text to `6 - imagesFound`.** The order already does this (L2514 pictorial, L2553 trim), but trim currently only shortens — add a top-up step: if `sharedSourcePool.length < (MAX_TOTAL_SOURCES - imagesCount)`, re-run the curated backfill pass with the new target. Concretely, factor the existing L2484–L2508 backfill into a small local helper `topUpFromCurated(target: number)` and call it twice: once after live fetch (target = 6) and once after the pictorial result is known (target = 6 - imagesCount).

3. **Update the log line at L2564** to reflect that the *total* should equal `MAX_TOTAL_SOURCES` whenever curated has enough excerpts.

Net behavior:
- 2 images → 4 text + 2 = 6
- 1 image → 5 text + 1 = 6
- 0 images → 6 text + 0 = 6

If the SS sub-issue bundle has fewer than 6 distinct-host excerpts (some are smaller), we accept same-host repeats in pass 2 of the backfill (already implemented at L2497–L2508) so we still hit 6. The existing `assertBundlePerspectiveMix` validator at module load guards quality.

### Fix 2 — refuse pictorials that don't anchor on sub-issue vocabulary

Edit `supabase/functions/generate-assessment/sources.ts` `fetchGroundedImageSources` (L889–L1024). No signature change.

1. **Introduce a "core vocab" subset.** Right after `const topicVocab = syllabusKeywordsFor(topic, learningOutcomes);` (~L910), build a *narrower* anchor list derived only from the `topic` argument (which is the bundle `subIssue` at the call site) and the first LO entry (which is `inquiryQuestion`):
   ```ts
   const coreVocab = syllabusKeywordsFor(topic, learningOutcomes.slice(0, 1))
     .filter(kw => kw.length >= 5);  // drop short common words
   ```
   This isolates the sub-issue-defining terms (e.g. "dormitory", "migrant", "integration") from the wider `contextWriteUp` vocab.

2. **Require BOTH at filter time** (~L985):
   - `r.kwHits >= 2` (was `> 0`) — at least two topic-vocab matches in the description, not one.
   - At least one `coreVocab` hit in the description. Track this in the `.map` step:
     ```ts
     let coreHits = 0;
     for (const kw of coreVocab) if (desc.includes(kw)) coreHits++;
     return { im, score, host, category, kwHits, coreHits, descLen };
     ```
     Then in `.filter`: `r.kwHits >= 2 && r.coreHits >= 1 && r.descLen >= 60 && (pass === "strict" ? r.score > 0 : r.score > -3)`.

3. **Re-verify on the printable caption** (~L997–L1001): keep the existing `captionKwHits > 0` check and add the same `coreHits` check on the caption:
   ```ts
   const captionCoreHits = coreVocab.filter(kw => captionLower.includes(kw)).length;
   if (captionKwHits < 2 || captionCoreHits < 1) continue;
   ```

4. **Drop the relaxed pass when `coreVocab.length >= 2`.** A bundle with a meaningful sub-issue should never fall back to relaxed scoring — better to ship 0 images than a generic one. At the top of the `for (const pass of passes)` loop:
   ```ts
   if (pass === "relaxed" && coreVocab.length >= 2 && picked.length === 0) {
     // strict found nothing on a well-defined sub-issue → don't loosen, just stop
     break;
   }
   ```
   For sparse-vocab topics (rare) the relaxed pass still runs as today.

Net effect: an image only ships if its caption contains at least two issue keywords AND at least one term that's specific to this bundle's sub-issue (not a generic shared word). The "Singapore stock photo" failure mode is closed.

### Verification

1. Regenerate the same "SS Test 9" sub-issue — confirm the SBQ ships 6 sources total whether pictorials qualify or not, and any pictorial that does ship has a caption naming the specific sub-issue vocabulary.
2. Regenerate one History SBQ (e.g. Cold War origins) — confirm 6 total sources and cartoons/posters still pass (their captions are typically rich).
3. Edge-function logs:
   - The `SBQ pool` line should consistently read `… text sources + N image(s) (cap 6 total, 2 pictorial)` with text + N = 6.
   - `[pictorial-miss]` may appear MORE often after Fix 2 — that's expected. It is no longer a failure path because text now fills the gap.

### Out of scope

- `MAX_IMAGE_SOURCES` (2), perspective-mix rule, mark schemes, SRQ/essay, DB schema, UI parsers, SS/History writeups.
- Query angles in `fetchGroundedImageSources` (already cover both genres).
- `syllabusKeywordsFor` itself — we derive the narrower `coreVocab` at the call site so existing callers are unaffected.

### Files touched

- `supabase/functions/generate-assessment/index.ts` — raise `FETCH_TARGET` to `MAX_TOTAL_SOURCES`; add a post-pictorial curated top-up call; update the summary log line. (~L2423, L2476–L2509, L2549–L2564.)
- `supabase/functions/generate-assessment/sources.ts` — add `coreVocab`, raise `kwHits` minimum to 2, require `coreHits >= 1` in both filter and caption re-check, skip relaxed pass when `coreVocab` is rich. (~L910, L959–L1001.)
