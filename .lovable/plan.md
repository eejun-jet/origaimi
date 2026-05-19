## What's wrong

### Problem 1 — the SS "Background to this issue" writeups read like source digests

The writeups rendered above the SBQ sources come verbatim from each bundle's `contextWriteUp` in `SS_SUB_ISSUE_BUNDLES` (`supabase/functions/generate-assessment/index.ts` ~L584–L700). Reading the migrant-workers one (L662) makes the pattern obvious — it walks paragraph-by-paragraph through what MOM said, then what the BBC reported, then ILO, then IPS-CNA. That structure mirrors the source list, not the issue:

> "The Government acknowledges… The 2020 COVID-19 outbreaks… NGOs like TWC2 describe… The ILO's global migrant-worker report supports… an IPS-CNA survey found…"

What the user wants instead, for SS Test 8 (migrant workers) and every other SS sub-issue: a 5–7 sentence paragraph that (1) names the central tension the foreign-worker presence creates, (2) lays out the competing views or stances on that tension (without naming sources), and (3) explains the wider context / why it matters. The sources should be the *evidence* a student reaches for after reading the framing — not the spine of the framing itself.

### Problem 2 — pictorial sources still ship with empty / generic captions

`fetchGroundedImageSources` in `sources.ts` (L889–L1019) requires `kwHits > 0` on the image *description* during ranking. That works to keep off-topic images out, but the caption that actually prints is built at L1003:

```ts
caption: (cand.im.description ?? "").trim().slice(0, 220) || `Pictorial source: ${topic}`,
```

So if a candidate has a thin description (e.g. 1–2 words that happened to match a keyword), or if the description got stripped, the printed caption becomes either a near-empty phrase or the fallback `"Pictorial source: <topic>"`. That's the user's "the infographic doesn't say anything" complaint — the image was technically aligned but its caption carried zero substance about the issue.

## Plan

### Fix 1 — rewrite all SS contextWriteUp strings to be tension-and-views first

Edit only `SS_SUB_ISSUE_BUNDLES` in `supabase/functions/generate-assessment/index.ts` (each `contextWriteUp` between ~L584 and ~L700). For every entry, replace the string with a 5–7 sentence writeup that follows this structure:

1. **Sentence 1–2 — the tension.** Open by naming the central issue and the tension it creates (e.g. for migrant workers: economic interdependence vs. residential/social separation; the diverse-society promise tested at the dormitory wall).
2. **Sentence 3–5 — the competing views.** Lay out the main positions WITHOUT naming sources — "the Government's position is…", "advocacy groups argue…", "researchers find…", "many citizens hold…", "comparative international evidence suggests…". Each clause names a stance + what it claims, not who said it. Both supportive and opposing framings appear.
3. **Sentence 6–7 — context and stakes.** Why the issue matters now (recent events, policy changes, what's at stake for citizenship / cohesion / identity).

Anti-patterns to avoid in the rewrite:
- Do NOT enumerate "MOM said X, BBC reported Y, ILO argued Z" — the sources do that job below.
- Do NOT cite specific publishers, report names, or single statistics tied to one source. Headline figures that frame the issue (e.g. "about 1.5 million foreign workers") are fine.
- Do NOT close with a meta line about how the sources were curated — the variety-of-perspectives rule is already enforced separately by `assertBundlePerspectiveMix`.

Apply this rewrite to all SS sub-issues currently in the bundle: housing inequality, public housing and identity, NS, civic participation, migrant workers, foreign immigrants/integration, and any others present in the file. The rewrite is content-only — no schema change, no new fields, no UI change. Existing parsers (`assessment.$id.tsx` L1473, `export-docx.ts` L50) already render whatever the writeup contains as "Background to this issue".

History bundles (L442–L540) are out of scope unless the user explicitly asks — they already read more issue-framed than the SS ones and the complaint was scoped to SS.

### Fix 2 — refuse images whose caption is too thin to carry the issue

Two tightenings in `fetchGroundedImageSources` (`supabase/functions/generate-assessment/sources.ts` L889–L1019), no signature change:

1. **Reject thin descriptions during ranking.** In the `.map(...)` block (~L960), compute a `descLen = desc.trim().length`. In the `.filter(...)` predicate (~L983) require `descLen >= 60` in addition to the existing `kwHits > 0` and pass-specific score check. A 60-char minimum (~10–12 words) is short enough that real infographic/photo captions clear it, long enough that a one-word stub is rejected.

2. **Recompute `kwHits` against the caption that will actually print, not a stripped lowercase scan.** Right before pushing (~L1000), build the printable caption first:

   ```ts
   const printableCaption = (cand.im.description ?? "").trim().slice(0, 220);
   const captionKwHits = topicVocab.filter(kw => kw.length >= 4 && printableCaption.toLowerCase().includes(kw)).length;
   if (captionKwHits === 0 || printableCaption.length < 60) continue;
   ```

   This guarantees what the student reads under the image contains at least one issue keyword and is substantive. If no candidate passes, ship 0 images — the existing `[pictorial-miss]` log line at `index.ts` L2537 already covers that branch and the section gracefully falls back to 4 text sources.

3. **Drop the generic fallback caption.** Replace the `|| \`Pictorial source: ${topic}\`` on the `caption:` line — if `printableCaption` is empty by this point we've already `continue`d, so the fallback is dead code that only ever fired for the thin-description case we now reject. Make `caption: printableCaption` unconditional.

Net effect: an image only ships if its caption stands on its own as a recognisable statement about the issue. The misaligned-infographic case the user saw can no longer pass.

### Verification

1. Regenerate the same SS Test 8 sub-issue (migrant workers) — confirm the "Background to this issue" block reads as a tension-and-views paragraph rather than a source-by-source digest, and confirm any pictorial source either has a substantive caption that mentions the issue or is absent.
2. Regenerate one more SS sub-issue (e.g. housing or NS) and confirm the same pattern.
3. Regenerate a History SBQ (e.g. Cold War origins) to confirm the History writeup still renders and pictorial cartoons/posters still come through (History rewrite is out of scope, behaviour unchanged).
4. In edge-function logs, look for `[pictorial-miss]` on the SS run to confirm the stricter caption filter only fires when truly nothing qualified.

### Out of scope

- No change to `MAX_IMAGE_SOURCES` (2), `MAX_TOTAL_SOURCES` (6), perspective-mix rule, mark schemes, SRQ/essay generation, DB schema, UI parsers.
- No change to History bundles (writeup or sources).
- No change to the source-fetch query angles (`photograph`, `news photo`, `infographic chart`, `political cartoon poster`) — they already cover the SS genre.

### Files touched

- `supabase/functions/generate-assessment/index.ts` — rewrite each SS `contextWriteUp` string in `SS_SUB_ISSUE_BUNDLES` (~L584–L700). No structural edits elsewhere.
- `supabase/functions/generate-assessment/sources.ts` — tighten `fetchGroundedImageSources` ranking filter + push-time caption check (~L960, L983, L1000–L1005).
