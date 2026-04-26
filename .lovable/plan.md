# Why “History mock paper” failed again

The backend generation function is being killed with:

```text
CPU Time exceeded
```

The failing path is the History source-based-question pipeline. After the earlier change to keep sources on-topic and cap them at 6, the generator now does too much live work before it can save the paper:

1. It seeds curated History sources.
2. It launches live text-source searches/scrapes with up to 14s per fetch.
3. If those under-deliver, it does a second “rescue” round of live searches/scrapes.
4. It then tries pictorial source search across many image query angles.
5. It then calls AI again to generate source provenances.

For a Cold War / History SBQ, those steps can exceed the compute limit before the deterministic question builder and database insert finish. That is why the generation fails even though the local app server is fine.

The logs also show the source fetcher still wasting time on unusable/off-topic results before shutdown, e.g. it dropped an irrelevant `analytics.usa.gov` result and then the function exceeded CPU.

# Fix plan

## 1. Make History SBQ generation bounded and deterministic

For humanities `source_based` sections:

- Use curated topic-matched sources first.
- Require enough curated text sources before doing live search.
- If curated sources already provide at least 4 text sources, skip live text crawling entirely.
- Keep the hard cap of 6 total sources.

This keeps “Origins of the Cold War” anchored to Cold War material instead of web-search drift.

## 2. Remove the expensive rescue pass

Delete or disable the second live “rescue” fetch round for SBQs. If initial fetches under-deliver, top up from curated sources only.

This prevents the function from repeatedly scraping the web after it already has usable sources.

## 3. Put pictorial sources on a strict budget

Change pictorial source fetching so it cannot dominate the run:

- Max 1 pictorial source by default for History SBQs, unless the curated bundle already includes a safe pictorial item.
- Shorten image search deadline substantially.
- Limit image query attempts to the first 2–3 angles, not all 7.
- If no picture is found quickly, continue without a picture rather than failing or timing out.

The UI will still label pictorial sources separately when present.

## 4. Remove AI provenance generation from the critical path

Skip `generateProvenances()` for SBQ generation and use deterministic provenance strings from publisher/title/date where available.

This saves another AI call and avoids spending compute after sources have already been selected.

## 5. Strengthen query/result filtering

Tighten search filtering so generic data/API pages are ignored earlier:

- Add `analytics.usa.gov` and similar data endpoints to the deny list.
- Reject CSV/API/data URLs before scraping.
- Prefer Cold War-specific curated bundles for topics matching “origins of the Cold War”, “Truman Doctrine”, “Marshall Plan”, “Berlin Blockade”, “Soviet expansion”, etc.

## 6. Better failure message

If a generation still fails due to backend limits, return a clearer UI error such as:

```text
History source generation took too long while collecting live sources. Try again, or reduce live source fetching.
```

But the main fix is to avoid hitting the limit in the first place.

# Files to update

- `supabase/functions/generate-assessment/index.ts`
  - Bound SBQ source pool work.
  - Disable rescue fetch.
  - Skip AI provenance for SBQs.
  - Reduce/limit image fetching.

- `supabase/functions/generate-assessment/sources.ts`
  - Tighten deny/filter rules.
  - Shorten image fetch loop/deadline.
  - Reject obvious data/API URLs early.

- Redeploy `generate-assessment` after changes.

# Expected result

“History mock paper” should generate successfully because the History SBQ path will no longer spend most of its backend budget crawling, rescuing, image-searching, and provenance-generating before inserting the assessment.

The output should still respect your source requirements:

- Cold War topic stays Cold War.
- No more than 6 sources total.
- Pictorial sources, when present, are clearly separated from documentary sources.
