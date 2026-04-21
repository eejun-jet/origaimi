

## Enforce 1-source-per-question for History & Social Studies

Right now, source-grounding is only triggered for question types the model labels `source_based` or `comprehension` — and only for English/Humanities subjects. For History & Social Studies, the model often picks `structured` or `long`, which means **no source gets attached at all**, even though every Humanities SBQ should be source-anchored. You also want a strict **1 source ↔ 1 question** mapping (no two questions sharing the same passage, no question without a source).

### What changes

For Humanities subjects (History, Social Studies, Combined Humanities):

1. **Every generated question gets exactly one source.** Regardless of whether the model labels it `source_based`, `structured`, or `long`, we fetch a grounded passage for it and attach `source_excerpt` + `source_url`.
2. **Every source is unique to one question.** The existing `usedHosts` set already prevents domain reuse; we'll additionally track `usedUrls` so the same article can never appear twice even if the host allow-list returns it again.
3. **If no source can be fetched for a Humanities question, the question is dropped** (with a warning logged) rather than emitted source-less. This guarantees the invariant "every Humanities question has a source."
4. **Question type is auto-promoted to `source_based`** for Humanities so the rendered card shows the passage + link UI properly (the editor already renders source UI conditionally on type).

English and other subjects keep current behavior (sources only for `source_based`/`comprehension`, structured essays stay clean — per your earlier rule).

### Technical changes

**File: `supabase/functions/generate-assessment/sources.ts`**
- Add `usedUrls?: Set<string>` parameter to `fetchGroundedSource` alongside the existing `usedHosts`. Skip any candidate URL already in the set; add successful URL on return.

**File: `supabase/functions/generate-assessment/index.ts`** (post-generation enrichment loop)
- Maintain `const usedHosts = new Set<string>()` and `const usedUrls = new Set<string>()` per assessment.
- For each generated question, detect Humanities via `isHumanitiesSubject(subject)`:
  - **Humanities branch**: always call `fetchGroundedSource("humanities", topic, los, usedHosts, usedUrls)`. If it returns a source → attach excerpt+url and force `question_type = "source_based"`. If it returns `null` → drop the question from the output array and log a warning.
  - **English branch**: keep current logic (only fetch when `questionTypeNeedsSource(qt)` is true).
  - **Other subjects**: unchanged.
- After enrichment, if Humanities and the dropped-question count left fewer than the requested total, log how many sources were missed (no auto-retry for now — keeps the loop bounded).

**No DB schema changes. No frontend changes** — `assessment.$id.tsx` already renders `source_excerpt` + clickable `source_url` for any question that has them.

### Edge cases handled

- Search returns 0 allow-listed results → question dropped (Humanities) or skipped (others), warning logged.
- All allow-listed results are from already-used hosts → question dropped, warning logged.
- Firecrawl scrape fails on every candidate → question dropped, warning logged.
- Tavily key missing → falls back to Firecrawl as today.

### Out of scope

- Retry loop to backfill dropped questions (would slow generation; revisit if drop rate is high).
- Letting users pick which source goes to which question (manual override).
- Changes to English subject behavior — kept as-is per the earlier conversation.

