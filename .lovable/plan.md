## Why pictorial sources never appear today

The History SBQ pool is built entirely from **text excerpts**. The `GroundedSource` type only carries `excerpt`, `source_url`, `source_title`, `publisher` — there is no image field, and `fetchGroundedSource` only calls `tavilySearch`/`firecrawlScrape` for **markdown text**. The "political cartoon poster propaganda" hint in `index.ts` (line 1115) is just a query keyword that biases the *text* search; it never asks Tavily for images, never extracts an `<img>`, and the renderer in `assessment.$id.tsx` only shows the textual `Source X: …` block from `source_excerpt`. So even when a search hits a page with a great cartoon, the system throws the image away and stores the surrounding article text.

A fully-working pictorial-source pipeline already exists in `diagrams.ts` (`fromTavilyImages` + `fromFirecrawl` → `pickBestImage`) and the DB already has `diagram_url` / `diagram_source` / `diagram_caption` / `diagram_citation` columns on `assessment_questions`. We can reuse both.

## What we'll change

### 1. Add a pictorial-source fetcher for humanities (`sources.ts`)

- Export a new `fetchGroundedImageSource()` that, given a topic + LOs, runs a Tavily image search restricted to the same humanities allow-list (with `includeImages: true, includeImageDescriptions: true`), filters to real raster/SVG URLs, ranks by allow-list membership + topic-keyword overlap with the description, and returns a new shape:
  ```
  { kind: "image", image_url, caption, source_url, source_title, publisher }
  ```
- Reuse the existing humanities allow-list, generic `.gov`/`.edu`/`.org` rule, and `DENY_DOMAINS` for filtering.
- Per-fetch timeout 6–8s, returns `null` on miss so it's non-fatal.

### 2. Slot images into the shared SBQ pool (`index.ts`)

In the `isHumanitiesSBQ` block (around line 1097–1170):
- After fetching the 5 textual sources, **always try to fetch ONE pictorial source** via `fetchGroundedImageSource()` (cartoon, poster, propaganda image, photograph).
- Append it to `sharedSourcePool` as the last entry (so it becomes Source E or F) tagged with a `kind: "image"` marker.
- Persist it on the question rows by:
  - Encoding it inside the existing `source_excerpt` text as `Source E: [IMAGE] caption — image_url` so older parsers still see something, AND
  - Writing the URL/caption into the existing `diagram_url` / `diagram_caption` / `diagram_source = "web"` / `diagram_citation` columns on the SBQ questions that reference it (these columns already exist; no migration needed).
- If the image fetch fails or returns null, the section silently keeps 5 text sources — never block generation.

### 3. Render the picture in the UI (`src/routes/assessment.$id.tsx`)

- Extend `parseSharedSourcePool()` to recognise the `[IMAGE] caption — url` marker and return entries shaped `{ label, kind: "image" | "text", text, imageUrl?, caption? }`.
- In the "Sources for this section" block, render image entries as `<img src=… alt=caption>` inside the same Source X card, with the caption beneath, plus the publisher citation link.
- Keep text-source rendering unchanged.

### 4. Expand primary-source publishers to all `.org` and `.edu` (`sources.ts`)

Today `.org` is allowed but tagged Tier 3 (last-resort), and `.edu` is Tier 1 only by TLD heuristic — both subordinated to the curated whitelist. Per your request, treat **all `.edu`, `.ac.uk`, `.ac.*`, `.gov`, `.gov.*`, `.mil`** AND **all `.org`** hosts as **Tier 1 primary publishers** for humanities, with these guardrails so quality stays high:

- Keep `DENY_DOMAINS` (Wikipedia, Quora, Reddit, Medium, Substack, blogspot, wordpress, tumblr, pinterest) as a hard block.
- Add a small extra deny list for low-quality `.org` aggregators that have caused noise before (e.g. `pinterest.com` is already denied; we'll add `slideshare.net`, `scribd.com`, `studocu.com`, `coursehero.com`, `chegg.com`, `prezi.com`, `weebly.com`).
- Promote `.org` to Tier 1 in `humanitiesTier()` so it's no longer down-ranked behind Britannica.
- The existing relevance + richness gates (`relevanceMetrics`, `richnessReason`, `JUNK_PATTERNS`) still filter out off-topic, thin, or catalogue-style pages, so opening up `.org`/`.edu` won't flood the pool with junk.
- The Tier-2 historiography cap (`maxTier2: 1`) is unchanged — your "primary sources first, scholars sparingly" rule is preserved.

### 5. Light prompt update (`index.ts`)

Add one line to the History SBQ prompt explaining that one of the supplied sources may be a pictorial source (cartoon/poster/photograph) referenced by `[IMAGE]` and the model should write a question that asks students to **interpret** it (e.g. "Study Source E. What is the message of the cartoonist?") rather than quote text from it.

## Files touched

- `supabase/functions/generate-assessment/sources.ts` — add `fetchGroundedImageSource`, new image-source type, expand Tier-1 to all `.edu`/`.org`/`.gov*`/`.ac.*`/`.mil`, add small deny list.
- `supabase/functions/generate-assessment/index.ts` — call image fetcher in SBQ pool builder, persist via existing `diagram_*` columns, add prompt note for pictorial source.
- `src/routes/assessment.$id.tsx` — parse `[IMAGE]` entries and render `<img>` inside the section's "Sources" card.

No DB migration needed (reusing `diagram_*` columns already on `assessment_questions`).

## What you'll see after deploy

- Generating a History SBQ section will produce 5 text sources **plus 1 cartoon/poster/photograph** (when one is found) — typically labelled Source F.
- The pictorial source displays inline with the text sources, with caption + clickable citation.
- Source diversity expands because any `.edu` / `.org` / `.gov*` / `.ac.*` host that passes the relevance + richness gates is now a first-class primary publisher, not a fallback.
