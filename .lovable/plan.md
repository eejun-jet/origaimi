## Goal
Every source in History/Social Studies SBQ sections must show a **one-sentence provenance** describing what the source is (e.g. "An editorial published in The Straits Times in August 1965", "A cartoon by David Low published in the Evening Standard, 1936"). The hyperlink to the original source must be displayed per source so reviewers can verify it.

## Why this matters
SEAB SBQ sources are always introduced by provenance — origin, author, date, audience. The current generator strips this context: students see only an excerpt or image. Provenance is also evidence used to evaluate reliability/utility, so it must be present for the questions themselves to be valid.

## Current behaviour
- `GroundedSource` and `GroundedImageSource` carry `source_url`, `source_title`, `publisher` — no provenance field.
- `source_excerpt` encodes the pool as `Source A: <text>` / `Source A: [IMAGE] caption — url`. Per-source URL is **not** encoded — the UI only shows ONE primary citation (Source A's URL) at the bottom of the Sources card.
- Frontend parser `parseSharedSourcePool` (`src/routes/assessment.$id.tsx`) extracts label + text/image only.

## Changes

### 1. `supabase/functions/generate-assessment/sources.ts`
- Add `provenance?: string` to `GroundedSource` and `GroundedImageSource` types.
- Add curated provenance entries to the existing `curatedHumanitiesSourcePool` bundles (WWII, Nazi/Weimar, Stalin, Cold War origins/end, SG decolonisation) so curated text sources ship with hand-written one-sentence provenance.

### 2. `supabase/functions/generate-assessment/provenance.ts` (new file)
- `generateProvenances(sources, images, topic): Promise<{textProv: string[], imageProv: string[]}>` — single Lovable AI Gateway call (`google/gemini-2.5-flash-lite`, `tool_choice` for structured JSON).
- Prompt instructs the model to write **one short historian's provenance sentence** per source, naming source type + author/issuer + venue/publisher + date when inferable, e.g. "A speech delivered by Winston Churchill to the House of Commons on 18 June 1940."
- Fallback when AI fails or omits an entry: deterministic `"From <publisher>: <source_title>."` so every source still has a value.
- 8s timeout — non-blocking; if it fails the section continues with the deterministic fallback.

### 3. `supabase/functions/generate-assessment/index.ts`
- After the SBQ pool (text + images) is assembled and BEFORE the prompt is sent to the main LLM, call `generateProvenances` and write the result back onto each source's `provenance` field. Use curated `provenance` if already present and skip those in the AI batch.
- Update the `[Source X]` blocks inside `sbqSectionPreamble` (around lines 724–741) so each source block lists `Provenance: <provenance>` and `Citation/Link: <source_url>`. The main LLM should reference provenance when writing utility/reliability sub-parts.
- Update the encoded `source_excerpt` writer (around lines 1410–1420) to a structured marker format the frontend can parse:
  - Text source: `Source A: [PROV] <provenance> [URL] <source_url> [TEXT] <excerpt>`
  - Image source: `Source A: [IMAGE] <caption> — <image_url> [PROV] <provenance> [URL] <source_url>`
  - Markers (`[PROV]`, `[URL]`, `[TEXT]`, `[IMAGE]`) are unique enough to be safely extracted with anchored regex without colliding with normal source text. Provenance and excerpt have any embedded `[PROV]/[URL]/[TEXT]` stripped before encoding (defensive sanitiser).

### 4. `src/routes/assessment.$id.tsx`
- Extend `ParsedSource` type:
  - Both variants gain `provenance?: string` and `sourceUrl?: string`.
- Update `parseSharedSourcePool`:
  - For each `Source X:` chunk, extract `[PROV] … [URL] … [TEXT] …` (text) or `[IMAGE] … — <imgUrl> [PROV] … [URL] …` (image). Fall back to current parsing when markers absent (back-compat with existing assessments).
- Update the Sources card render (around lines 727–754):
  - Above the excerpt/image, show `Provenance: <provenance>` in italic muted text.
  - Below each source, show `View source ↗` linking to that source's `sourceUrl` (replacing — or in addition to — the single "Primary citation" footer; keep the footer hidden when per-source links are present).

### 5. `.lovable/plan.md`
Append a note recording the new provenance requirement and encoding format so future edits preserve it.

## Notes
- No database migration. `assessment_questions.source_excerpt` is text and stores the marker-encoded pool as before.
- Back-compat: existing assessments without `[PROV]` markers continue to render via the existing fallback path.
- Cost: one extra `gemini-2.5-flash-lite` call per SBQ section (~5–6 sources). Budget impact is negligible compared to the main generation call.
