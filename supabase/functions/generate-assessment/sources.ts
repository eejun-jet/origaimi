// Source-grounding helpers for History / Social Studies SBQs and English
// comprehension / visual text passages. Uses Firecrawl (search + scrape) via
// the connector's API key, restricted to a curated allow-list of legitimate
// primary / news / heritage / literary domains.
//
// Returns null if no usable 100–180 word excerpt can be extracted.

import { tavilySearch, hasTavily } from "../_shared/tavily.ts";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

// Allow-list for History / Social Studies (primary / news / heritage).
const ALLOW_DOMAINS_HUMANITIES = [
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

// Allow-list for English (literary / journalistic / public-domain prose & non-fiction).
// Bias toward sources whose passages teachers can legitimately use as comprehension
// or visual text stimulus material.
const ALLOW_DOMAINS_ENGLISH = [
  // Public-domain literature and verified texts
  "gutenberg.org", "standardebooks.org", "poetryfoundation.org", "poets.org",
  // Long-form journalism & reportage (well-edited prose)
  "bbc.co.uk", "theguardian.com", "nytimes.com", "reuters.com", "apnews.com",
  "channelnewsasia.com", "straitstimes.com", "todayonline.com",
  "nationalgeographic.com", "smithsonianmag.com", "theatlantic.com",
  "newyorker.com", "aeon.co", "longreads.com",
  // Short fiction / essays
  "narrativemagazine.com", "granta.com", "lithub.com",
  // Singapore literary / cultural
  "nlb.gov.sg", "roots.gov.sg",
];

const DENY_DOMAINS = [
  "wikipedia.org", "wikiwand.com", "quora.com", "reddit.com",
  "medium.com", "blogspot.com", "wordpress.com", "substack.com",
  "tumblr.com", "pinterest.com",
];

const MIN_WORDS = 100;
const MAX_WORDS = 180;

export type SubjectKind = "humanities" | "english" | null;

export type GroundedSource = {
  excerpt: string;
  source_url: string;
  source_title: string;
  publisher: string;
};

export function classifySubject(subject: string | null | undefined): SubjectKind {
  if (!subject) return null;
  const s = subject.toLowerCase();
  if (s.includes("history") || s.includes("social studies") || s.includes("humanities")) {
    return "humanities";
  }
  // Match "English", "English Language", "EL", but avoid "Mathematics" etc.
  if (/\benglish\b/.test(s) || s.trim() === "el") return "english";
  return null;
}

export function isHumanitiesSubject(subject: string | null | undefined): boolean {
  return classifySubject(subject) === "humanities";
}

export function isEnglishSubject(subject: string | null | undefined): boolean {
  return classifySubject(subject) === "english";
}

/** Question types that benefit from a grounded passage. */
export function questionTypeNeedsSource(qt: string | null | undefined): boolean {
  if (!qt) return false;
  return qt === "source_based" || qt === "comprehension";
}

export function buildQuery(
  subjectKind: Exclude<SubjectKind, null>,
  topic: string,
  learningOutcomes: string[] = [],
): string {
  const lo = learningOutcomes[0] ?? "";
  const base = `${topic} ${lo}`.trim();
  if (subjectKind === "english") {
    // Bias toward narrative / descriptive / journalistic prose suitable for
    // comprehension and visual text questions.
    return `${base} short passage prose excerpt`;
  }
  // Humanities: bias toward archival / news content.
  return `${base} primary source historical account`;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isAllowed(url: string, allowList: string[]): boolean {
  const h = hostnameOf(url);
  if (!h) return false;
  if (DENY_DOMAINS.some((d) => h.endsWith(d) || h.includes(d))) return false;
  return allowList.some((d) => h === d || h.endsWith("." + d) || h.endsWith(d));
}

function publisherOf(url: string): string {
  const h = hostnameOf(url);
  return h.replace(/^www\./, "");
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Phrases commonly found in nav/footer/paywall/CTA boilerplate that should never
// appear inside a comprehension or source-based excerpt.
const JUNK_PATTERNS: RegExp[] = [
  /\blog ?in\b/i, /\bsign ?in\b/i, /\bsign ?up\b/i, /\bregister\b/i,
  /\bcreate (a |an )?(free )?account\b/i, /\blogin to (your |a )?(free )?account\b/i,
  /\bsubscribe\b/i, /\bsubscription\b/i, /\bnewsletter\b/i,
  /\bcookie(s)?\b.*\b(policy|consent|accept)\b/i, /\baccept (all )?cookies\b/i,
  /\bprivacy policy\b/i, /\bterms (of (use|service)|and conditions)\b/i,
  /\b(read|continue) (more|reading)\b/i, /\bclick here\b/i,
  /\badvertisement\b/i, /\bsponsored\b/i, /\bshare (this )?(article|story)\b/i,
  /\bfollow us\b/i, /\bdownload the app\b/i, /\bpaywall\b/i,
  /\bsupport (our|independent) journalism\b/i, /\bbecome a (member|supporter)\b/i,
  /\bcopyright\b|©/i, /\ball rights reserved\b/i,
];

function isJunkSentence(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  // Very short fragments are usually nav/headers, not prose.
  if (countWords(t) < 4) return true;
  return JUNK_PATTERNS.some((re) => re.test(t));
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

  // Split into sentences, then drop boilerplate/CTA/nav junk.
  const rawSentences = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  const sentences = rawSentences.filter((s) => !isJunkSentence(s));
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

async function firecrawlSearch(query: string, allowList: string[]): Promise<string[]> {
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
  const results = json?.data?.web ?? json?.web ?? json?.data ?? [];
  const urls: string[] = [];
  for (const r of results) {
    const url = r?.url ?? r?.link;
    if (typeof url === "string") urls.push(url);
  }
  return urls.filter((u) => isAllowed(u, allowList)).slice(0, 5);
}

/** Try Tavily first (native domain filtering), fall back to Firecrawl. */
async function searchUrls(query: string, allowList: string[]): Promise<string[]> {
  if (hasTavily()) {
    const { results } = await tavilySearch(query, {
      includeDomains: allowList,
      excludeDomains: DENY_DOMAINS,
      maxResults: 10,
    });
    const urls = results.map((r) => r.url).filter((u) => isAllowed(u, allowList));
    if (urls.length > 0) return urls.slice(0, 5);
    console.warn("[sources] tavily returned 0 allow-listed results, falling back to firecrawl");
  }
  return firecrawlSearch(query, allowList);
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
  subjectKind: Exclude<SubjectKind, null>,
  topic: string,
  learningOutcomes: string[] = [],
): Promise<GroundedSource | null> {
  const allowList = subjectKind === "english" ? ALLOW_DOMAINS_ENGLISH : ALLOW_DOMAINS_HUMANITIES;
  const query = buildQuery(subjectKind, topic, learningOutcomes);
  const urls = await searchUrls(query, allowList);
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
