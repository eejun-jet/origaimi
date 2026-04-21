// Source-grounding helpers for History / Social Studies SBQs and English
// comprehension / visual text passages. Uses Firecrawl (search + scrape) via
// the connector's API key, restricted to a curated allow-list of legitimate
// primary / news / heritage / literary domains.
//
// Returns null if no usable 100–180 word excerpt can be extracted.

import { tavilySearch, hasTavily } from "../_shared/tavily.ts";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

// Allow-list for History / Social Studies. Strongly biased toward PRIMARY
// SOURCES (archives, government records, museum collections, contemporary
// news reportage, speeches, treaties, official documents) and SECONDARY
// SOURCES that present a HISTORIAN'S PERSPECTIVE (academic essays, scholarly
// articles, edited reference works). General journalism and tertiary
// reference sites are kept only as a last-resort fallback.
const ALLOW_DOMAINS_HUMANITIES = [
  // --- PRIMARY SOURCES: Singapore archives & heritage ---
  "nas.gov.sg",                 // National Archives of Singapore
  "eresources.nlb.gov.sg",      // NLB digitised newspapers, oral history
  "nlb.gov.sg",                 // National Library Board (Infopedia, BiblioAsia)
  "roots.gov.sg",               // National Heritage Board collections
  "mindef.gov.sg", "gov.sg",    // Singapore government statements / records
  // --- PRIMARY SOURCES: International archives, museums, official records ---
  "nationalarchives.gov.uk", "bl.uk",         // UK National Archives, British Library
  "archives.gov", "loc.gov",                  // US National Archives, Library of Congress
  "iwm.org.uk", "awm.gov.au", "ushmm.org",    // Imperial War Museum, AWM, USHMM
  "un.org",                                    // UN treaties, resolutions, speeches
  "avalon.law.yale.edu",                       // Avalon Project — primary documents
  "founders.archives.gov",                     // Founding-era US documents
  "fordham.edu",                               // Internet History Sourcebooks (primary docs)
  "wilsoncenter.org",                          // Cold War International History Project (declassified docs)
  // --- SECONDARY SOURCES: historians' perspectives, scholarly analysis ---
  "jstor.org",                  // peer-reviewed historical scholarship
  "historytoday.com",           // historian-authored essays
  "historyextra.com",           // BBC History Magazine, historian commentary
  "oxfordre.com",               // Oxford Research Encyclopedias
  "britannica.com",             // edited reference, often historian-authored
  // --- Contemporary news reportage (treated as primary for recent events) ---
  "straitstimes.com", "channelnewsasia.com", "todayonline.com",
  "bbc.co.uk", "reuters.com", "apnews.com",
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

// Tiered preference for humanities domains. Tier 1 = primary sources;
// Tier 2 = historian / scholarly secondary sources; Tier 3 = general
// reference / contemporary news (last resort).
const HUMANITIES_TIER_1_PRIMARY = new Set([
  "nas.gov.sg", "eresources.nlb.gov.sg", "nlb.gov.sg", "roots.gov.sg",
  "mindef.gov.sg", "gov.sg",
  "nationalarchives.gov.uk", "bl.uk", "archives.gov", "loc.gov",
  "iwm.org.uk", "awm.gov.au", "ushmm.org", "un.org",
  "avalon.law.yale.edu", "founders.archives.gov", "fordham.edu",
  "wilsoncenter.org",
]);
const HUMANITIES_TIER_2_HISTORIAN = new Set([
  "jstor.org", "historytoday.com", "historyextra.com",
  "oxfordre.com", "britannica.com",
]);

function humanitiesTier(host: string): 1 | 2 | 3 {
  // Walk parent domains for subdomain matches (e.g. www.nas.gov.sg → nas.gov.sg).
  const parts = host.split(".");
  for (let i = 0; i < parts.length; i++) {
    const d = parts.slice(i).join(".");
    if (HUMANITIES_TIER_1_PRIMARY.has(d)) return 1;
    if (HUMANITIES_TIER_2_HISTORIAN.has(d)) return 2;
  }
  return 3;
}

const MIN_WORDS = 120;
const MAX_WORDS = 200;

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

// Words removed from queries — they're noise that hurts search relevance.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "by", "with", "and",
  "or", "but", "as", "is", "are", "was", "were", "be", "been", "being",
  "case", "study", "studies", "key", "developments", "extension", "outside",
  "between", "within", "during", "from", "this", "that", "these", "those",
  "examine", "explain", "describe", "outline", "discuss", "compare", "analyse",
  "assess", "evaluate", "students", "learners", "should", "able", "understand",
  "level", "syllabus", "section", "topic", "outcome", "outcomes", "learning",
]);

function extractKeywords(text: string, max: number): string[] {
  const cleaned = text
    .replace(/[*_`#]+/g, " ")
    .replace(/[–—]/g, "-")           // unicode dashes → ascii so 1954-75 stays joined
    .replace(/[^a-zA-Z0-9\-\s]/g, " ")
    .toLowerCase();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    if (w.length < 2) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Build a list of progressively broader queries to try. Earlier = more specific.
 *  For humanities we issue alternating primary-source / historian-perspective
 *  queries so the search engine returns rich, analysable passages rather than
 *  thin tertiary blurbs. */
export function buildQueryChain(
  subjectKind: Exclude<SubjectKind, null>,
  topic: string,
  learningOutcomes: string[] = [],
): string[] {
  const topicKw = extractKeywords(topic, 5);
  const loKw = extractKeywords((learningOutcomes[0] ?? ""), 4);
  const chain: string[] = [];
  if (subjectKind === "english") {
    const suffix = "short prose excerpt";
    if (topicKw.length > 0 && loKw.length > 0) chain.push(`${[...topicKw, ...loKw].join(" ")} ${suffix}`);
    if (topicKw.length > 0) chain.push(`${topicKw.join(" ")} ${suffix}`);
    if (topicKw.length >= 2) chain.push(`${topicKw.slice(0, 2).join(" ")} ${suffix}`);
  } else {
    // Humanities: alternate primary-source and historian-perspective queries.
    const base = topicKw.join(" ");
    const baseWithLo = [...topicKw, ...loKw].join(" ");
    if (topicKw.length > 0 && loKw.length > 0) {
      chain.push(`${baseWithLo} primary source document archive`);
      chain.push(`${baseWithLo} historian analysis`);
    }
    if (topicKw.length > 0) {
      chain.push(`${base} primary source document`);
      chain.push(`${base} historian perspective scholarly`);
      chain.push(`${base} contemporary account`);
    }
    if (topicKw.length >= 2) {
      chain.push(`${topicKw.slice(0, 2).join(" ")} primary source`);
    }
  }
  return Array.from(new Set(chain));
}

// Backwards-compat single-query helper (kept for any older callers).
export function buildQuery(
  subjectKind: Exclude<SubjectKind, null>,
  topic: string,
  learningOutcomes: string[] = [],
): string {
  return buildQueryChain(subjectKind, topic, learningOutcomes)[0] ?? topic;
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

/** Search + scrape + extract a usable 100–180 word excerpt. Returns null on total failure.
 *  When `usedHosts` is provided, results from already-used hostnames are skipped so each
 *  generated assessment ends up with at most one source per site.
 *  When `usedUrls` is provided, exact URLs already used are skipped so the same article
 *  can never be reused even if the host allow-list returns it again. */
export async function fetchGroundedSource(
  subjectKind: Exclude<SubjectKind, null>,
  topic: string,
  learningOutcomes: string[] = [],
  usedHosts?: Set<string>,
  usedUrls?: Set<string>,
): Promise<GroundedSource | null> {
  const allowList = subjectKind === "english" ? ALLOW_DOMAINS_ENGLISH : ALLOW_DOMAINS_HUMANITIES;
  const queries = buildQueryChain(subjectKind, topic, learningOutcomes);
  if (queries.length === 0) {
    console.warn("[sources] could not build any search query for topic:", topic);
    return null;
  }

  // Walk the query chain (most specific → most general) until we get hits.
  for (const query of queries) {
    const urls = await searchUrls(query, allowList);
    if (urls.length === 0) {
      console.warn("[sources] no allow-listed results for query:", query);
      continue;
    }
    const candidates = urls.filter((u) => {
      if (usedUrls && usedUrls.has(u)) return false;
      if (usedHosts && usedHosts.has(hostnameOf(u))) return false;
      return true;
    });
    if (candidates.length === 0) {
      console.warn("[sources] all candidates already used for query:", query);
      continue;
    }
    for (const url of candidates.slice(0, 5)) {
      try {
        const scraped = await firecrawlScrape(url);
        if (!scraped) continue;
        const excerpt = extractExcerpt(scraped.markdown);
        if (!excerpt) continue;
        const host = hostnameOf(url);
        if (usedHosts) usedHosts.add(host);
        if (usedUrls) usedUrls.add(url);
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
  }
  return null;
}
