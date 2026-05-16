# Why pictorial sources are missing from SS / History papers

There are two distinct root causes in `supabase/functions/generate-assessment/index.ts` and `sources.ts`. Together they explain why both subjects currently ship SBQ sections with zero images.

## Root cause 1 — Social Studies skips the image fetch entirely

`supabase/functions/generate-assessment/index.ts` lines 2073–2098:

```ts
if (ssSubIssueForSection) {
  console.log(`… skipping pictorial fetch — SS sub-issue uses curated text-only bundle`);
} else {
  // … fetchGroundedImageSources(...)
}
```

Whenever a Social Studies paper matches one of the curated `SS_SUB_ISSUE_BUNDLES` (which is the normal/happy path for SS Combined Humanities P1), the pictorial fetch is **explicitly bypassed**. The curated bundle ships 5 text excerpts and 0 images, so the generated section has no pictorial source.

This was originally added because a generic topic-keyword image search returned off-topic pictures. The fix is not to skip — it is to (a) prefer a curated pictorial attached to the bundle when available, and (b) fall back to a tightly-scoped Tavily image search using the bundle's sub-issue keywords rather than the broad topic.

## Root cause 2 — History fetch only runs the "strict" pass

`supabase/functions/generate-assessment/sources.ts` lines 910–913:

```ts
// Single pass only — we previously had 3 passes (strict / relaxed / final)…
const passes: Array<"strict" | "relaxed" | "final"> = ["strict"];
```

The relaxed and final fallback passes were removed for latency. The strict pass requires:

- Tavily image result on the humanities allow-list
- positive score (Tier‑1 host bonus or keyword overlap in the image description)
- within a 6s deadline

If keyword overlap is weak (very common — Tavily image descriptions are short and noisy) or the only matches sit outside the allow-list, the function returns `[]`, and the caller logs `"no pictorial source found (continuing without)"`. The History SBQ then ships text-only.

## The fix

Two surgical changes, both inside `supabase/functions/generate-assessment/`:

1. **`index.ts` (~line 2078)** — stop skipping the pictorial fetch for SS sub-issues. Instead:
   - If `ssSubIssueForSection` has an attached curated pictorial (new optional `image` field on `SsSubIssueBundle`), use it directly.
   - Otherwise call `fetchGroundedImageSources` with the bundle's `subIssue` string as the topic and the bundle's `triggers`-derived keywords as the LO seed, so the image search is bound to the actual inquiry rather than the broad paper topic.

2. **`sources.ts` `fetchGroundedImageSources` (~line 913)** — restore the staged fallback so the function does not silently return zero:
   - Pass 1 `strict` — current behaviour (allow-list + positive score).
   - Pass 2 `relaxed` — same allow-list, accept any score > −3 (drop only obvious logos/icons).
   - Pass 3 `final` — drop the allow-list (still drop DENY_DOMAINS), accept score > −3.
   - Keep the existing 6s wall-clock so latency stays bounded; the extra passes only run if no image has been picked yet and there is budget left.
   - Keep the per-host de-dupe so the chosen image still comes from a distinct publisher.

3. **Light hardening** — at the section assembly site, if after both fixes `sharedImageSources.length === 0`, log a `WARN [pictorial-miss]` with the section letter, topic, and elapsed ms so future misses are observable in edge-function logs without changing the user-visible behaviour.

## Out of scope

- No DB schema changes.
- No UI changes — the existing renderer already shows pictorial sources when present.
- Not adding a "regenerate just the image" button (separate request if you want it).

## Verification after implementation

- Generate one History SBQ paper and one SS Combined Humanities P1, check edge-function logs for `pictorial source <url>` per section, and confirm the rendered paper shows at least one image-anchored sub-part per SBQ section.
