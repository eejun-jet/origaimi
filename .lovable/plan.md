

## Add Tavily as a second web-search provider (alongside Firecrawl)

You'll provide a **Tavily API key** and the generator will use Tavily as an additional crawl/search backend. Firecrawl stays — Tavily complements it.

### How the two providers will be used

Tavily and Firecrawl have different strengths, so we'll route by job:

| Job | Primary | Fallback |
|---|---|---|
| **Web search** (find candidate URLs on allow-listed domains) for History/Social Studies sources, English passages, and Math/Science diagrams | **Tavily** (`/search` — fast, returns ranked results with snippets and `include_domains` filter) | Firecrawl `/v2/search` |
| **Page scrape** (pull full markdown of a chosen URL to extract a 100–180 word excerpt) | **Firecrawl** `/v2/scrape` (best markdown quality, `onlyMainContent`) | Tavily `/extract` |
| **Image discovery** for diagrams (find labelled figures on Khan Academy, OpenStax, etc.) | **Tavily** (`include_images: true`) | Firecrawl |

This means Tavily becomes the default **search + image-finder** (cheaper, faster, native domain filtering), while Firecrawl stays the default **page-content extractor** (best markdown).

### Changes

**Secret**: Add `TAVILY_API_KEY` as a runtime secret. I'll prompt you with `add_secret` once you approve.

**New file**: `supabase/functions/_shared/tavily.ts` — thin wrapper exposing:
- `tavilySearch(query, { includeDomains, excludeDomains, maxResults, includeImages })` → POSTs to `https://api.tavily.com/search`
- `tavilyExtract(urls)` → POSTs to `https://api.tavily.com/extract` (fallback for scrape)

**Updated files**:
- `supabase/functions/generate-assessment/sources.ts` — replace `firecrawlSearch` with a `searchUrls()` helper that tries Tavily first (with `include_domains` = our allow-list), falls back to Firecrawl. Scraping still uses Firecrawl. Allow-list and deny-list logic unchanged.
- `supabase/functions/generate-assessment/diagrams.ts` — for the "web crawl for diagrams" tier (tier 2), use Tavily with `include_images: true` to find diagram URLs on the allow-listed Math/Science domains. Falls back to Firecrawl. AI generation tier (tier 3) and past-paper tier (tier 1) unchanged.

**No DB changes, no UI changes.** Behaviour is transparent — citations on questions and diagrams continue to render exactly as today; only the upstream provider changes.

### Failure / cost behaviour

- If `TAVILY_API_KEY` is missing → silently fall through to Firecrawl-only (current behaviour).
- If Tavily returns 0 allow-listed results → fall through to Firecrawl.
- If Tavily returns a 401/402/429 → log + fall through to Firecrawl, never crash the generation.

### What you need to do

1. Approve this plan.
2. When prompted, paste your Tavily API key (get one free at tavily.com — 1,000 searches/month on the free tier).

Once added I'll wire both providers in and we can verify by generating a History SBQ (text source via Tavily search → Firecrawl scrape) and a Physics paper (diagram URL via Tavily image search → embedded with citation).

