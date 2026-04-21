// Thin wrapper around the Tavily API (https://docs.tavily.com).
// Used as the primary search backend for source discovery and image discovery,
// with Firecrawl as a fallback. Returns empty/null on any failure so callers
// can transparently fall through to the next provider.

const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY") ?? "";

export type TavilySearchResult = {
  url: string;
  title: string;
  content: string;
  score?: number;
};

export type TavilyImage = {
  url: string;
  description?: string;
};

export type TavilySearchResponse = {
  results: TavilySearchResult[];
  images: TavilyImage[];
};

export function hasTavily(): boolean {
  return TAVILY_API_KEY.length > 0;
}

export async function tavilySearch(
  query: string,
  opts: {
    includeDomains?: string[];
    excludeDomains?: string[];
    maxResults?: number;
    includeImages?: boolean;
    includeImageDescriptions?: boolean;
    searchDepth?: "basic" | "advanced";
  } = {},
): Promise<TavilySearchResponse> {
  if (!TAVILY_API_KEY) return { results: [], images: [] };
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: opts.maxResults ?? 10,
        include_domains: opts.includeDomains ?? undefined,
        exclude_domains: opts.excludeDomains ?? undefined,
        include_images: opts.includeImages ?? false,
        include_image_descriptions: opts.includeImageDescriptions ?? false,
        search_depth: opts.searchDepth ?? "basic",
      }),
    });
    if (!resp.ok) {
      console.warn("[tavily] search failed", resp.status, await resp.text().catch(() => ""));
      return { results: [], images: [] };
    }
    const json = await resp.json();
    const results: TavilySearchResult[] = Array.isArray(json?.results)
      ? json.results.map((r: { url?: string; title?: string; content?: string; score?: number }) => ({
          url: String(r?.url ?? ""),
          title: String(r?.title ?? ""),
          content: String(r?.content ?? ""),
          score: typeof r?.score === "number" ? r.score : undefined,
        })).filter((r: TavilySearchResult) => r.url)
      : [];
    const rawImages = Array.isArray(json?.images) ? json.images : [];
    const images: TavilyImage[] = rawImages.map((im: unknown) => {
      if (typeof im === "string") return { url: im };
      const o = im as { url?: string; description?: string };
      return { url: String(o?.url ?? ""), description: o?.description };
    }).filter((im: TavilyImage) => im.url);
    return { results, images };
  } catch (e) {
    console.warn("[tavily] search exception", e);
    return { results: [], images: [] };
  }
}

export async function tavilyExtract(urls: string[]): Promise<{ url: string; raw_content: string }[]> {
  if (!TAVILY_API_KEY || urls.length === 0) return [];
  try {
    const resp = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls }),
    });
    if (!resp.ok) {
      console.warn("[tavily] extract failed", resp.status);
      return [];
    }
    const json = await resp.json();
    const out = Array.isArray(json?.results) ? json.results : [];
    return out.map((r: { url?: string; raw_content?: string }) => ({
      url: String(r?.url ?? ""),
      raw_content: String(r?.raw_content ?? ""),
    })).filter((r: { url: string }) => r.url);
  } catch (e) {
    console.warn("[tavily] extract exception", e);
    return [];
  }
}
