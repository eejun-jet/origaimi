## Goal

Each History/Social Studies SBQ section currently fetches only **one** pictorial source (cartoon/poster/photo) appended to ~5 text sources. Update generation so every SBQ section delivers **at least 2 pictorial sources** (out of 5–6 total), maximum 3, drawn from cartoons, posters, photographs, **graphs, charts, maps, and statistical tables**.

## Changes

### 1. `supabase/functions/generate-assessment/sources.ts`

- **Broaden image categories.** Extend `fetchGroundedImageSource` query angles beyond `cartoon / poster / photograph` to also include:
  - `graph chart statistics`
  - `map historical`
  - `data table figure`
  Also widen the description-bonus regex so `graph|chart|map|diagram|figure|table|statistic` boost the score (currently only matches cartoon/poster/photograph/portrait/etc.).
- **Return multiple distinct images.** Add a new helper `fetchGroundedImageSources(topic, learningOutcomes, count, usedHosts)` that:
  - Iterates the (now wider) query list.
  - Collects up to `count` images from **distinct hosts** and from **distinct visual categories** where possible (e.g. one cartoon + one chart, not two cartoons from the same archive).
  - Reuses existing `IMAGE_URL_RE`, `isAllowed`, Tier-1 ranking, and `usedHosts` deduping.
  - Returns `GroundedImageSource[]` (possibly empty if Tavily is unavailable or nothing passes filters).
- Keep the existing single-image function exported as a thin wrapper for backward compatibility.

### 2. `supabase/functions/generate-assessment/index.ts`

- Replace `let sharedImageSource: GroundedImageSource | null` with `const sharedImageSources: GroundedImageSource[] = []`.
- In the SBQ pool builder:
  - **Reduce text-source target from 5 to a minimum of 3 (target 4)** so the section still totals 5–6 sources once 2 images are added (5 text + 2 image would exceed the 6-source ceiling and crowd the prompt).
  - Call `fetchGroundedImageSources(topic, los, 2, usedHosts)` after the text fetch.
  - If fewer than 2 images come back, retry once with a fallback query angle, then accept whatever count was found (logged as a soft warning — don't fail the section as long as ≥1 image and ≥3 text sources are present, matching the existing "≥2 sources" hard floor).
- Update the prompt assembly (around lines 716–770):
  - Compute `imageLabels` for each image (`String.fromCharCode(65 + pool.length + i)`).
  - Render each pictorial source as its own `[Source X] PICTORIAL PRIMARY SOURCE` block with caption + image URL + citation.
  - Update the rules text so "anchor on a pictorial source ⇒ ask students to interpret the image" applies to **all** image labels, and explicitly note that graphs/charts/maps require interpretation of trends, scale, projection, or data — not quotation.
- Update the `source_excerpt` writer (around lines 1402–1413) to append **one `[IMAGE]` marker per pictorial source** instead of just one. The renderer (`parseSharedSourcePool` in `src/routes/assessment.$id.tsx`) already handles multiple `[IMAGE]` markers — no UI changes needed.
- Update the per-section log line to report the image count (e.g. `4 text sources + 2 images`).

### 3. `.lovable/plan.md`

Append a short note recording the new pictorial-source minimum so future iterations preserve it.

## Notes

- No DB migration required — `assessment_questions.source_excerpt` already stores the concatenated marker string.
- No frontend changes — `parseSharedSourcePool` already iterates and renders any `[IMAGE]` entries.
- The hard floor (`sharedSourcePool.length < 2 → skip section`) still applies to text sources; image fetches remain best-effort to avoid section drops on Tavily misses, but the prompt and stats explicitly target 2 images.