## What's actually wrong

Two independent issues are conspiring on your Nazi-Germany SBQ:

**1. The domain allow-list is too narrow for niche History topics.**
For Humanities, `fetchGroundedSource` calls Tavily with `include_domains: ALLOW_DOMAINS_HUMANITIES` (a fixed list of ~30 archives + a generic `.gov / .edu / .ac.* / .mil / .org` TLD rule). On a topic like *Life in Nazi Germany* — where the richest material lives on `.de` archives (e.g. `dhm.de`, `bundesarchiv.de`), university course pages, museum sites with non-`.org` TLDs, project sites like `alphahistory.com`, and curated educator portals — the search returns very few candidates. The fetcher then walks DOWN the query chain into more generic queries ("nazi germany primary source") and grabs whatever .org/.edu page mentions Germany — which is how Munich-Treaty and Paris-Peace-Conference pages slip in: same era, same .org/.gov TLD, passes the allow-list, weakly passes the keyword gate.

**2. The relevance gate is too lenient.**
`relevanceMetrics` accepts an excerpt if it overlaps ≥25% of the syllabus vocabulary AND has ≥2 keyword hits. For *Life in Nazi Germany* the topic vocabulary likely reduces to {nazi, germany, hitler, youth, propaganda, women, gestapo, …}. A Munich Treaty page mentions "Germany", "Hitler", "appeasement" — that's 2 hits and ~25%, so it passes. The gate doesn't distinguish "a few generic words shared" from "this excerpt is actually about the topic."

You wanted a third thing too: **drop the hard reputable-only restriction for History/SS specifically**, while still preferring authoritative sources.

## What the change does

Three coordinated changes in `supabase/functions/generate-assessment/sources.ts`, all Humanities-only (English allow-list stays unchanged):

### A. Open the search, keep the preference

- For `subjectKind === "humanities"`, **stop passing `include_domains` to Tavily** (and stop applying the strict allow-list filter to Firecrawl results). Search the open web.
- Keep `DENY_DOMAINS` as a hard block (Wikipedia, Reddit, essay mills, Quora, blogspot, etc. — these were the original "junk" list and stay banned).
- Keep `humanitiesTier()` as a *ranking* signal, not a *gating* signal. Tier-1 (gov/archive/museum) gets a big boost, Tier-2 (JSTOR, History Today, HistoryExtra) a smaller one, everything else passes through with a small penalty. Per-pool Tier-2 budget stays in place so we don't fill an SBQ with five historiography essays.
- Add a soft **publisher quality floor**: reject hosts that look like content farms or shopping/affiliate domains (heuristic on TLD + path patterns like `/products/`, `/shop/`, `/cart/`), plus the existing data-endpoint regex. This is cheap and catches the obvious junk that opening the web invites.

### B. Make the relevance gate strict enough to catch "Munich Treaty in a Nazi Germany pool"

Replace the single proportion-AND-hits gate with a layered check. An excerpt must satisfy ALL of:

1. **Topic-anchor hit (NEW, hard requirement).** At least one *topic-anchor* keyword (drawn from the topic title + LO subjects, NOT verbs/adjectives) must appear ≥ 2 times in the excerpt. For *Life in Nazi Germany* anchors would include `nazi`, `germany`, `hitler youth`, `gestapo`, `propaganda`, `volksgemeinschaft`. The Munich Treaty page mentions "Hitler" once and "Germany" once — fails.
2. **Anchor density.** Anchor-keyword occurrences per 100 words must be ≥ 1.0. This is what separates "a passage about Nazi Germany" from "a passage about 1930s Europe that names Germany twice."
3. **Existing proportional overlap** of the full topic + LO vocabulary, but the threshold rises to **≥ 35%** AND **≥ 3 distinct keywords matched** (was 25% / 2). The old numbers were tuned for the curated allow-list; with the open web they're too generous.
4. **Negative-topic guard for Humanities.** When the topic clearly belongs to one well-known historical episode, build a small list of *adjacent-but-distinct* episodes from a hand-curated map and reject excerpts whose anchor density for an *adjacent* topic exceeds the chosen topic's density. The map covers the half-dozen confusable Sec 3/4 History pairs that actually cause this problem (Life in Nazi Germany ↔ Treaty of Versailles / Munich Agreement / Paris Peace Conference / Appeasement; Cold War origins ↔ WWII end; Singapore independence ↔ Malayan Emergency). Small, explicit, easy to extend later.

### C. Tighten the queries so the search engine has a fighting chance

The current chain dilutes specific topics with generic suffixes ("primary source document archive"). Two changes:

- For Humanities, prepend the **full topic title as a quoted phrase** to the first 3 queries (e.g. `"life in Nazi Germany" hitler youth propaganda primary source`). Tavily and Firecrawl both honour quoted phrases; this alone removes the bulk of off-topic returns.
- Stop emitting the most generic two-word query (`topicKw.slice(0,2).join(" ") primary source`) for Humanities — it's the one that surfaces the Paris Peace Conference. Replace it with a focused fallback: `"<topic title>" archive document`.

Curated topic-anchor extraction lives in a small new helper `topicAnchors(topic, learningOutcomes)` in the same file: drops STOPWORDS, drops generic history vocabulary (`century`, `period`, `era`, `empire`, `government`, `treaty`, `agreement`, `world`, `war`, `policy` when used alone), preserves multi-word proper nouns from the topic title.

## What you'll see

- For *Life in Nazi Germany*: the source pool draws from museums (USHMM, IWM, DHM), Bundesarchiv, university course pages, BBC History, History Today, plus open-web educator sites like `alphahistory.com` — and stops returning Munich-Treaty / Paris-Peace-Conference excerpts because they fail the anchor-density gate.
- For other humanities topics: same broadening of accepted publishers, plus fewer "weakly on-topic" excerpts in general.
- Logs include the new gate reasons (`anchor-density-too-low`, `adjacent-topic-stronger=<x>`) so when you see a confusing pool you can read the edge logs and tell exactly why a candidate was kept or dropped.

## Files to change

- `supabase/functions/generate-assessment/sources.ts` — only file. Changes are scoped to: Humanities branch of `searchUrls` / `firecrawlSearch` / `tavilySearch` call sites, `relevanceMetrics` (replaced by `relevanceVerdict`), `buildQueryChain`, plus two new pure helpers (`topicAnchors`, `ADJACENT_TOPICS`).

No DB changes, no UI changes, no new secrets. English allow-list and pictorial-image flow are untouched.
