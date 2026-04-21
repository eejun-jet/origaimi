// Source-grounding helpers for History / Social Studies SBQs.
// Uses Firecrawl (search + scrape) via the connector's API key, restricted
// to a curated allow-list of legitimate primary / news / heritage domains.
//
// Returns null if no usable 100–180 word excerpt can be extracted.

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

const ALLOW_DOMAINS = [
  // Singapore primary / heritage
  "nas.gov.sg", "nlb.gov.sg", "roots.gov.sg", "eresources.nlb.gov.sg",
  "mindef.gov.sg", "gov.sg",
  // Singapore news
  "straitstimes.com", "channelnewsasia.com", "todayonline.com",
  // International news / reference
  "bbc.co.uk", "reuters.com", "apnews.com", "britannica.com",
  // International archives / museums
  "bl.uk", "iwm.org.uk", "nationalarchives.gov.uk", "loc.gov", "un.org",
];

const DENY_DOMAINS = [
  "wikipedia.org", "wikiwand.com", "quora.com", "reddit.com",
  "medium.com", "blogspot.com", "wordpress.com",
];

const MIN_WORDS = 100;
const MAX_WORDS = 180;

export type GroundedSource = {
  excerpt: string;
  source_url: string;
  source_title: string;
  publisher: string;
};

export function isHumanitiesSubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return s.includes("history") || s.includes("social studies") || s.includes("humanities");
}

export function buildQuery(topic: string, learningOutcomes: string[] = []): string {
  const lo = learningOutcomes[0] ?? "";
  const base = `${topic} ${lo}`.trim();
  // Bias toward primary-source language so we get archival / news content.
  return `${base} primary source historical account`;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isAllowed(url: string): boolean {
  const h = hostnameOf(url);
  if (!h) return false;
  if (DENY_DOMAINS.some((d) => h.endsWith(d) || h.includes(d))) return false;
  return ALLOW_DOMAINS.some((d) => h === d || h.endsWith("." + d) || h.endsWith(d));
}

function publisherOf(url: string): string {
  const h = hostnameOf(url);
  return h.replace(/^www\./, "");
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Extract a sentence-bounded contiguous excerpt of 100–180 word from markdown. */
function extractExcerpt(markdown: string): string | null {
  if (!markdown) return null;
  // Strip markdown noise: code blocks, images, links syntax, headings markers, tables.
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Split into paragraphs by sentence groupings.
  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  if (sentences.length === 0) return null;

  // Greedy window: keep adding sentences until we exceed MAX_WORDS,
  // then back off; if window ≥ MIN_WORDS, return it. Slide forward otherwise.
  for (let i = 0; i < sentences.length; i++) {
    let buf = "";
    for (let j = i; j < sentences.length; j++) {
      const next = (buf + " " + sentences[j]).trim();
      const w = countWords(next);
      if (w > MAX_WORDS) {
        if (countWords(buf) >= MIN_WORDS) return buf.trim();
        break; // window starting at i can't satisfy; advance i
      }
      buf = next;
      if (w >= MIN_WORDS && w <= MAX_WORDS) return buf.trim();
    }
  }
  return null;
}

async function firecrawlSearch(query: string): Promise<string[]> {
  if (!FIRECRAWL_API_KEY) return [];
  const resp = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: 10 }),
  });
  if (!resp.ok) {
    console.warn("[sources] firecrawl search failed", resp.status, await resp.text());
    return [];
  }
  const json = await resp.json();
  // v2 shape: { data: { web: [{ url, title, ... }] } } or { web: [...] }
  const results = json?.data?.web ?? json?.web ?? json?.data ?? [];
  const urls: string[] = [];
  for (const r of results) {
    const url = r?.url ?? r?.link;
    if (typeof url === "string") urls.push(url);
  }
  return urls.filter(isAllowed).slice(0, 5);
}

async function firecrawlScrape(url: string): Promise<{ markdown: string; title: string } | null> {
  if (!FIRECRAWL_API_KEY) return null;
  const resp = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!resp.ok) {
    console.warn("[sources] firecrawl scrape failed", resp.status, url);
    return null;
  }
  const json = await resp.json();
  const data = json?.data ?? json;
  const markdown: string = data?.markdown ?? "";
  const title: string = data?.metadata?.title ?? data?.title ?? "";
  if (!markdown) return null;
  return { markdown, title };
}

/** Search + scrape + extract a usable 100–180 word excerpt. Returns null on total failure. */
export async function fetchGroundedSource(
  topic: string,
  learningOutcomes: string[] = [],
): Promise<GroundedSource | null> {
  const query = buildQuery(topic, learningOutcomes);
  const urls = await firecrawlSearch(query);
  if (urls.length === 0) {
    console.warn("[sources] no allow-listed search results for query:", query);
    return null;
  }
  for (const url of urls.slice(0, 3)) {
    try {
      const scraped = await firecrawlScrape(url);
      if (!scraped) continue;
      const excerpt = extractExcerpt(scraped.markdown);
      if (!excerpt) continue;
      return {
        excerpt,
        source_url: url,
        source_title: scraped.title || publisherOf(url),
        publisher: publisherOf(url),
      };
    } catch (e) {
      console.warn("[sources] scrape error for", url, e);
    }
  }
  console.warn("[sources] no usable excerpt extracted for query:", query);
  return null;
}
