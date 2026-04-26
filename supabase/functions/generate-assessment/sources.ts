// Source-grounding helpers for History / Social Studies SBQs and English
// comprehension / visual text passages. Uses Firecrawl (search + scrape) via
// the connector's API key, restricted to a curated allow-list of legitimate
// primary / news / heritage / literary domains.
//
// Returns null if no usable 100–180 word excerpt can be extracted.

import { tavilyExtract, tavilySearch, hasTavily } from "../_shared/tavily.ts";

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
  "parliament.uk", "hansard.parliament.uk",   // UK Parliament debates / records (primary)
  "archives.gov", "loc.gov", "nara.gov",      // US National Archives, Library of Congress
  "state.gov",                                 // US State Dept (Office of the Historian — primary docs)
  "cia.gov",                                   // CIA Reading Room (declassified records)
  "iwm.org.uk", "awm.gov.au", "ushmm.org",    // Imperial War Museum, AWM, USHMM
  "un.org",                                    // UN treaties, resolutions, speeches
  "avalon.law.yale.edu",                       // Avalon Project — primary documents
  "founders.archives.gov",                     // Founding-era US documents
  "fordham.edu",                               // Internet History Sourcebooks (primary docs)
  "wilsoncenter.org", "digitalarchive.wilsoncenter.org", // Cold War declassified docs
  "cvce.eu",                                   // European integration primary documents
  "marxists.org",                              // Primary political texts (speeches, manifestos)
  "digital.library.cornell.edu",               // Cornell digital primary collections
  // --- SECONDARY SOURCES: historians' perspectives, scholarly analysis ---
  // Used SPARINGLY — capped per source pool (see tierBudget in fetchGroundedSource).
  "jstor.org",                  // peer-reviewed historical scholarship
  "historytoday.com",           // historian-authored essays
  "historyextra.com",           // BBC History Magazine, historian commentary
  "oxfordre.com",               // Oxford Research Encyclopedias
  // --- Contemporary news reportage (treated as primary for recent events) ---
  "straitstimes.com", "channelnewsasia.com", "todayonline.com",
  "bbc.co.uk", "reuters.com", "apnews.com",
  // --- Tertiary reference (last-resort fallback only) ---
  "britannica.com",             // edited reference (Tier 3)
];

// Generic TLD allow rule for humanities: any .gov, .edu, .ac.uk, .gov.* (e.g.
// .gov.au, .gov.sg), .mil, .org, .ac.* host is treated as primary/official by
// default. Per teacher request, .org and .edu hosts are now first-class
// publishers (subject to DENY_DOMAINS + relevance/richness gates).
const HUMANITIES_TLD_TIER_1 = [".gov", ".edu", ".ac.uk", ".mil", ".org"];
// (Tier-3 list kept empty — promoted to Tier-1.)
const HUMANITIES_TLD_TIER_3: string[] = [];

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
  // User-generated, unreliable, or aggregator content
  "wikipedia.org", "wikiwand.com", "quora.com", "reddit.com",
  "medium.com", "blogspot.com", "wordpress.com", "substack.com",
  "tumblr.com", "pinterest.com",
  // Low-quality .org / .com aggregators that polluted earlier pools.
  // These often surface in .org/.edu searches but are essay mills, slide
  // sharing, or note-swap sites — never legitimate primary publishers.
  "slideshare.net", "scribd.com", "studocu.com", "coursehero.com",
  "chegg.com", "prezi.com", "weebly.com", "academia.edu",
  "sparknotes.com", "cliffsnotes.com", "shmoop.com", "schmoop.com",
  "studymode.com", "bartleby.com", "enotes.com",
];

// Tiered preference for humanities domains. Tier 1 = primary sources;
// Tier 2 = historian / scholarly secondary sources; Tier 3 = general
// reference / contemporary news (last resort).
const HUMANITIES_TIER_1_PRIMARY = new Set([
  "nas.gov.sg", "eresources.nlb.gov.sg", "nlb.gov.sg", "roots.gov.sg",
  "mindef.gov.sg", "gov.sg",
  "nationalarchives.gov.uk", "bl.uk",
  "parliament.uk", "hansard.parliament.uk",
  "archives.gov", "loc.gov", "nara.gov",
  "state.gov", "cia.gov",
  "iwm.org.uk", "awm.gov.au", "ushmm.org", "un.org",
  "avalon.law.yale.edu", "founders.archives.gov", "fordham.edu",
  "wilsoncenter.org", "digitalarchive.wilsoncenter.org",
  "cvce.eu", "marxists.org", "digital.library.cornell.edu",
]);
// Tier 2 = historian / scholarly secondary perspective. Britannica deliberately
// excluded — it is a tertiary reference (Tier 3), not a historian's voice.
const HUMANITIES_TIER_2_HISTORIAN = new Set([
  "jstor.org", "historytoday.com", "historyextra.com", "oxfordre.com",
]);

// Additional academic / government TLD suffixes that should count as Tier-1
// even though they don't appear verbatim in HUMANITIES_TLD_TIER_1 (which uses
// short TLDs only). E.g. ".ac.au" (Australian universities), ".edu.sg".
const HUMANITIES_TLD_TIER_1_SUFFIXES = [
  ".ac.au", ".ac.nz", ".ac.jp", ".ac.kr", ".ac.in", ".ac.id", ".ac.za",
  ".edu.au", ".edu.sg", ".edu.my", ".edu.hk", ".edu.cn", ".edu.tw",
  ".gov.uk", ".gov.au", ".gov.nz", ".gov.sg", ".gov.ca", ".gov.in",
];

export function humanitiesTier(host: string): 1 | 2 | 3 {
  // Tier-2 (historian/historiography) takes precedence over the generic .org
  // rule so jstor.org / historyextra.com keep their scholarly classification.
  const parts = host.split(".");
  for (let i = 0; i < parts.length; i++) {
    const d = parts.slice(i).join(".");
    if (HUMANITIES_TIER_2_HISTORIAN.has(d)) return 2;
    if (HUMANITIES_TIER_1_PRIMARY.has(d)) return 1;
  }
  // Generic TLD heuristic: official government / academic / military / .org
  // hosts are treated as primary by default (subject to DENY_DOMAINS).
  if (HUMANITIES_TLD_TIER_1.some((tld) => host.endsWith(tld) || host.includes(tld + "."))) return 1;
  if (HUMANITIES_TLD_TIER_1_SUFFIXES.some((sfx) => host.endsWith(sfx))) return 1;
  return 3;
}

export type TierBudget = { tier2Used: number; maxTier2: number };

const MIN_WORDS = 150;
const MAX_WORDS = 240;

export type SubjectKind = "humanities" | "english" | null;

export type GroundedSource = {
  excerpt: string;
  source_url: string;
  source_title: string;
  publisher: string;
};

/** A pictorial primary source — cartoon, propaganda poster, photograph, etc.
 *  Discovered via Tavily image search and gated against the same allow-list /
 *  deny-list as text sources. The renderer turns this into "Source X" with
 *  an embedded image and the same publisher citation. */
export type GroundedImageSource = {
  kind: "image";
  image_url: string;
  caption: string;
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
 *  thin tertiary blurbs. Uses ALL learning outcomes (not just the first) so
 *  searches stay anchored to the syllabus. An optional `queryHint` injects
 *  extra context (used by the SBQ pool to vary across A/B/C/D/E fetches). */
export function buildQueryChain(
  subjectKind: Exclude<SubjectKind, null>,
  topic: string,
  learningOutcomes: string[] = [],
  queryHint?: string,
): string[] {
  const topicKw = extractKeywords(topic, 5);
  // Pull keywords from EVERY learning outcome, not just the first, so the
  // search vocabulary actually reflects what the syllabus covers.
  const allLoText = learningOutcomes.join(" ");
  const loKw = extractKeywords(allLoText, 6);
  const hintKw = queryHint ? extractKeywords(queryHint, 3) : [];
  const chain: string[] = [];
  const hintSuffix = hintKw.length > 0 ? ` ${hintKw.join(" ")}` : "";
  if (subjectKind === "english") {
    const suffix = "short prose excerpt";
    if (topicKw.length > 0 && loKw.length > 0) chain.push(`${[...topicKw, ...loKw].join(" ")} ${suffix}${hintSuffix}`);
    if (topicKw.length > 0) chain.push(`${topicKw.join(" ")} ${suffix}${hintSuffix}`);
    if (topicKw.length >= 2) chain.push(`${topicKw.slice(0, 2).join(" ")} ${suffix}`);
  } else {
    // Humanities: HEAVILY bias toward primary sources. We emit ~4 primary-source
    // queries for every 1 historian-perspective query so the search engine
    // surfaces archives, contemporary reportage, speeches and treaties first.
    // Historiography / scholar perspectives are allowed but capped per pool by
    // the caller's tierBudget (see fetchGroundedSource).
    const base = topicKw.join(" ");
    const baseWithLo = [...topicKw, ...loKw].join(" ");
    if (topicKw.length > 0 && loKw.length > 0) {
      chain.push(`${baseWithLo} primary source document archive${hintSuffix}`);
      chain.push(`${baseWithLo} archival document${hintSuffix}`);
    }
    if (topicKw.length > 0) {
      chain.push(`${base} contemporary newspaper account${hintSuffix}`);
      chain.push(`${base} speech treaty official record${hintSuffix}`);
      chain.push(`${base} primary source document${hintSuffix}`);
      chain.push(`${base} eyewitness account memoir${hintSuffix}`);
      // Single historiography query, deliberately last among the specific ones.
      chain.push(`${base} historian analysis scholarly${hintSuffix}`);
    }
    if (topicKw.length >= 2) {
      chain.push(`${topicKw.slice(0, 2).join(" ")} primary source`);
    }
  }
  return Array.from(new Set(chain));
}

/** Exposed for callers that need the syllabus-relevance vocabulary. */
export function syllabusKeywordsFor(topic: string, learningOutcomes: string[] = []): string[] {
  return [...extractKeywords(topic, 8), ...extractKeywords(learningOutcomes.join(" "), 10)];
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

function isAllowed(url: string, allowList: string[], allowGenericTlds = false): boolean {
  const h = hostnameOf(url);
  if (!h) return false;
  if (DENY_DOMAINS.some((d) => h.endsWith(d) || h.includes(d))) return false;
  if (allowList.some((d) => h === d || h.endsWith("." + d) || h.endsWith(d))) return true;
  // For humanities, also allow any .gov, .edu, .ac.uk, .mil, or .org host as
  // a Tier-1 primary publisher (gated by DENY_DOMAINS + downstream
  // relevance/richness checks). Generic TLD rule is off for English.
  if (allowGenericTlds) {
    if (HUMANITIES_TLD_TIER_1.some((tld) => h.endsWith(tld) || h.endsWith(tld + ".sg") || h.endsWith(tld + ".au") || h.endsWith(tld + ".uk") || h.endsWith(tld + ".nz") || h.endsWith(tld + ".ca"))) {
      return true;
    }
    if (HUMANITIES_TLD_TIER_1_SUFFIXES.some((sfx) => h.endsWith(sfx))) {
      return true;
    }
  }
  return false;
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
  // Browser/tech warnings.
  /\bbrowser is out of date\b/i, /\bupdate(ing)? your browser\b/i, /\bplease consider updating\b/i,
  /\bmay not support some of the features\b/i, /\bimage lightbox\b/i,
  /\bview (this )?(term )?in the glossary\b/i, /\bclose\s+image\b/i,
  /\benable javascript\b/i, /\bjavascript is (disabled|required)\b/i,
  // Archive listing / catalogue captions.
  /\bblack[- ]?and[- ]?white negatives?\b/i, /\bcolor (slides?|photographs?|negatives?)\b/i,
  /\bcatalog(ue)? record\b/i, /\bfinding aid\b/i, /\bcollection (overview|guide|finding aid)\b/i,
  /\bview (the )?(full )?(record|item|object)\b/i, /\bdownload (image|pdf|document)\b/i,
  /\b(prints? (and|&) photographs? division)\b/i, /\b(call number|shelfmark|accession number)\b/i,
  /\b(digital id|reproduction number|repository)\s*[:#]/i,
  /\b(timeline overview|primary source timeline)\b/i,
  // Navigation / breadcrumbs.
  /\bback to (top|search|results)\b/i, /\bskip to (main )?content\b/i,
  /\b(home|search|menu|browse)\s*[›»>]\s*/i,
  /\bpage \d+ of \d+\b/i, /\bnext\s+page\b/i, /\bprevious\s+page\b/i,
  // Image / media captions and credits.
  /^\s*(figure|fig\.|image|photo|photograph|plate|table|chart|map)\s+\d+/i,
  /\b(photo|image|illustration|portrait|engraving)\s+(by|courtesy of|credit|source)\b/i,
  /\b(courtesy of|reproduced (with )?permission|getty images|associated press)\b/i,
  // Site chrome / utility / related-content widgets.
  /\b(about us|contact us|site map|sitemap|help cent(er|re)|customer service)\b/i,
  /\b(related (articles|stories|content|posts)|you (may|might) (also )?like|recommended for you)\b/i,
  /\b(view profile|edit profile|my account|sign out|log out)\b/i,
  // Search / filter UI.
  /\b(filter (by|results)|sort by|show more|load more|refine (your )?search)\b/i,
  /\b(\d+\s+(results?|items?|articles?|matches?)\s+found)\b/i,
];

function isJunkSentence(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  // Very short fragments are usually nav/headers, not prose.
  if (countWords(t) < 4) return true;
  // Reject sentences with too many capitalised "Title Case Phrase Words" — a
  // signature of catalogue listings ("Wife of a Migratory Laborer, 1938 Farm
  // Security Administration/Office of War Information Black-and-White Negatives").
  const caps = (t.match(/\b[A-Z][a-z]+/g) ?? []).length;
  const words = countWords(t);
  if (words >= 8 && caps / words > 0.55) return true;
  return JUNK_PATTERNS.some((re) => re.test(t));
}

/** Compute simple keyword-overlap relevance between an excerpt and the syllabus
 *  topic + learning outcomes. Used to drop scrapes that have nothing to do with
 *  the topic the teacher actually selected. Returns both the proportional score
 *  and the number of distinct keywords matched so callers can apply a strict
 *  AND-gate (proportion AND raw hits) rather than the previous OR-gate which
 *  let off-topic but keyword-dense pages slip through. */
function relevanceMetrics(
  excerpt: string,
  topicKeywords: string[],
): { score: number; hits: number; matched: string[] } {
  if (topicKeywords.length === 0) return { score: 1, hits: 0, matched: [] };
  const lc = excerpt.toLowerCase();
  const matched: string[] = [];
  for (const kw of topicKeywords) {
    if (kw.length < 3) continue;
    if (lc.includes(kw)) matched.push(kw);
  }
  return {
    score: matched.length / Math.max(1, topicKeywords.length),
    hits: matched.length,
    matched,
  };
}

/** Heuristic richness check: a "rich" excerpt for source-based analysis must
 *  read like analytical / narrative prose, not a list of captions, headlines,
 *  or metadata. We require:
 *   - Enough sentences (≥ 4) of reasonable average length (≥ 12 words avg)
 *   - At least one analytical / argumentative cue word (because, however,
 *     therefore, although, despite, claimed, argued, suggests, evidence, etc.)
 *   - Low ratio of ALL-CAPS / Title-Case-heavy fragments (catalogue signature)
 *  Returns a reason string when rejected so logs explain why. */
function richnessReason(excerpt: string): string | null {
  const text = excerpt.trim();
  const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? []).map((s) => s.trim()).filter(Boolean);
  if (sentences.length < 4) return `too-few-sentences(${sentences.length})`;
  const totalWords = countWords(text);
  const avg = totalWords / sentences.length;
  if (avg < 12) return `avg-sentence-too-short(${avg.toFixed(1)}w)`;

  const ANALYTICAL_CUES = /\b(because|however|therefore|thus|although|though|despite|whereas|while|meanwhile|claim(ed|s)?|argu(e|ed|es)|suggests?|implies?|reveals?|demonstrates?|shows?|illustrates?|evidence|effect|cause|consequence|result(ed|ing|s)?|impact(ed|ing|s)?|influenc(e|ed|ing)|policy|government|nation|war|colonial|independence|movement|reform|protest|treaty|agreement|crisis|conflict|reaction|response|opinion|view|believe[ds]?)\b/i;
  if (!ANALYTICAL_CUES.test(text)) return "no-analytical-cues";

  // Catalogue / listing signature: many fragments dominated by Title Case nouns
  // (e.g. "Office of War Information Black-and-White Negatives").
  const titleHeavy = sentences.filter((s) => {
    const words = countWords(s);
    if (words < 6) return false;
    const caps = (s.match(/\b[A-Z][a-z]+/g) ?? []).length;
    return caps / words > 0.45;
  }).length;
  if (titleHeavy / sentences.length > 0.4) return "catalogue-listing-signature";

  return null;
}

/** Extract a sentence-bounded contiguous excerpt of 100–200 words from markdown.
 *  Requires at least 3 prose sentences in the window so we never return a list
 *  of catalogue captions glued together. */
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
  if (sentences.length < 3) return null;

  // Greedy window: keep adding sentences until we exceed MAX_WORDS,
  // then back off; require ≥3 sentences AND ≥MIN_WORDS for a valid excerpt.
  for (let i = 0; i < sentences.length; i++) {
    let buf = "";
    let count = 0;
    for (let j = i; j < sentences.length; j++) {
      const next = (buf + " " + sentences[j]).trim();
      const w = countWords(next);
      if (w > MAX_WORDS) {
        if (count >= 3 && countWords(buf) >= MIN_WORDS) return buf.trim();
        break;
      }
      buf = next;
      count++;
      if (w >= MIN_WORDS && w <= MAX_WORDS && count >= 3) return buf.trim();
    }
  }
  return null;
}

async function firecrawlSearch(query: string, allowList: string[], allowGenericTlds: boolean): Promise<string[]> {
  if (!FIRECRAWL_API_KEY) return [];
  const resp = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: 8 }),
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
  return urls.filter((u) => isAllowed(u, allowList, allowGenericTlds)).slice(0, 6);
}

/** Try Tavily first (native domain filtering), fall back to Firecrawl. */
async function searchUrls(query: string, allowList: string[], allowGenericTlds: boolean): Promise<string[]> {
  if (hasTavily()) {
    // For humanities, don't constrain Tavily by includeDomains (the curated list
    // is too narrow once we accept .gov/.edu broadly); rely on isAllowed to gate.
    const { results } = await tavilySearch(query, {
      includeDomains: allowGenericTlds ? undefined : allowList,
      excludeDomains: DENY_DOMAINS,
      maxResults: 8,
    });
    const urls = results.map((r) => r.url).filter((u) => isAllowed(u, allowList, allowGenericTlds));
    if (urls.length > 0) return urls.slice(0, 6);
    console.warn("[sources] tavily returned 0 allow-listed results, falling back to firecrawl");
  }
  return firecrawlSearch(query, allowList, allowGenericTlds);
}

/** Sort humanities URLs so Tier 1 (primary) comes first, then Tier 2 (historian),
 *  then Tier 3 (general reference / news). For English, preserve search order. */
function rankUrlsForSubject(subjectKind: SubjectKind, urls: string[]): string[] {
  if (subjectKind !== "humanities") return urls;
  return [...urls].sort((a, b) => humanitiesTier(hostnameOf(a)) - humanitiesTier(hostnameOf(b)));
}

async function firecrawlScrape(url: string): Promise<{ markdown: string; title: string } | null> {
  if (!FIRECRAWL_API_KEY) return null;
  // Per-scrape timeout: a single slow site must not block the whole pool.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: ctrl.signal,
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
  } catch (e) {
    console.warn("[sources] firecrawl scrape error/timeout", url, (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tavilyScrape(url: string): Promise<{ markdown: string; title: string } | null> {
  try {
    const extracted = await tavilyExtract([url]);
    const raw = extracted[0]?.raw_content ?? "";
    if (!raw) return null;
    return { markdown: raw, title: publisherOf(url) };
  } catch (e) {
    console.warn("[sources] tavily extract error", url, (e as Error).message);
    return null;
  }
}

async function scrapeUrl(url: string): Promise<{ markdown: string; title: string } | null> {
  return (await tavilyScrape(url)) ?? (await firecrawlScrape(url));
}

/** Search + scrape + extract a usable, syllabus-relevant 100–200 word excerpt.
 *  Returns null on total failure.
 *  - `usedHosts` / `usedUrls` prevent the same site/article being reused.
 *  - `queryHint` lets callers vary search context across multiple fetches for
 *    the same topic (e.g. building an SBQ pool of Sources A–E).
 *  - The excerpt MUST overlap the syllabus topic + learning-outcome vocabulary
 *    (>= 25% keyword hit rate); otherwise we treat it as off-topic and skip. */
export async function fetchGroundedSource(
  subjectKind: Exclude<SubjectKind, null>,
  topic: string,
  learningOutcomes: string[] = [],
  usedHosts?: Set<string>,
  usedUrls?: Set<string>,
  queryHint?: string,
  tierBudget?: TierBudget,
): Promise<GroundedSource | null> {
  const deadline = Date.now() + (subjectKind === "humanities" ? 14_000 : 10_000);
  const allowList = subjectKind === "english" ? ALLOW_DOMAINS_ENGLISH : ALLOW_DOMAINS_HUMANITIES;
  const allowGenericTlds = subjectKind === "humanities";
  const queries = buildQueryChain(subjectKind, topic, learningOutcomes, queryHint);
  if (queries.length === 0) {
    console.warn("[sources] could not build any search query for topic:", topic);
    return null;
  }

  // Vocabulary used for relevance gating: the topic plus ALL learning outcomes.
  const topicVocab = syllabusKeywordsFor(topic, learningOutcomes);
  const MIN_RELEVANCE = 0.25;
  const MIN_RELEVANCE_HITS = 2;
  const tier2Exhausted = (): boolean =>
    !!tierBudget && tierBudget.tier2Used >= tierBudget.maxTier2;

  // Walk the query chain (most specific → most general) until we get hits.
  for (const query of queries.slice(0, subjectKind === "humanities" ? 3 : 2)) {
    if (Date.now() > deadline) return null;
    const urls = await searchUrls(query, allowList, allowGenericTlds);
    if (urls.length === 0) {
      console.warn("[sources] no allow-listed results for query:", query);
      continue;
    }
    const candidates = rankUrlsForSubject(subjectKind, urls).filter((u) => {
      if (usedUrls && usedUrls.has(u)) return false;
      if (usedHosts && usedHosts.has(hostnameOf(u))) return false;
      // Per-pool budget: once Tier-2 (historian/historiography) quota is spent,
      // drop further Tier-2 candidates so the pool stays primary-source heavy.
      if (subjectKind === "humanities" && tier2Exhausted() && humanitiesTier(hostnameOf(u)) === 2) {
        return false;
      }
      return true;
    });
    if (candidates.length === 0) {
      console.warn("[sources] all candidates already used for query:", query);
      continue;
    }
    for (const url of candidates.slice(0, subjectKind === "humanities" ? 3 : 2)) {
      if (Date.now() > deadline) return null;
      try {
        const scraped = await scrapeUrl(url);
        if (!scraped) continue;
        const excerpt = extractExcerpt(scraped.markdown);
        if (!excerpt) continue;

        const { score, hits, matched } = relevanceMetrics(excerpt, topicVocab);
        if (score < MIN_RELEVANCE || hits < MIN_RELEVANCE_HITS) {
          console.warn(`[sources] dropped off-topic excerpt (score=${score.toFixed(2)}, hits=${hits}, matched=[${matched.join(",")}]) from ${url}`);
          continue;
        }

        const poor = richnessReason(excerpt);
        if (poor) {
          console.warn(`[sources] dropped thin excerpt (${poor}) from ${url}`);
          continue;
        }

        const host = hostnameOf(url);
        if (usedHosts) usedHosts.add(host);
        if (usedUrls) usedUrls.add(url);
        if (tierBudget && subjectKind === "humanities" && humanitiesTier(host) === 2) {
          tierBudget.tier2Used += 1;
        }
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

// ─────────────────────────────────────────────────────────────────────────────
// Pictorial primary-source fetcher (Humanities only).
// Uses Tavily image search restricted to the humanities allow-list +
// .gov/.edu/.org/.mil/.ac.* TLDs. Returns a single best image with a caption,
// or null on miss. Designed to be called ONCE per SBQ section, after the
// textual pool has been assembled.
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_URL_RE = /\.(png|jpe?g|gif|svg|webp)(\?|#|$)/i;

export async function fetchGroundedImageSource(
  topic: string,
  learningOutcomes: string[] = [],
  usedHosts?: Set<string>,
): Promise<GroundedImageSource | null> {
  if (!hasTavily()) return null;
  const topicKw = extractKeywords(topic, 5);
  const loKw = extractKeywords(learningOutcomes.join(" "), 4);
  if (topicKw.length === 0) return null;

  // Try a few angles — propaganda poster, cartoon, photograph — so we surface
  // a real pictorial primary source rather than an article hero image.
  const baseTerms = [...topicKw, ...loKw].slice(0, 8).join(" ");
  const queries = [
    `${baseTerms} political cartoon`,
    `${baseTerms} propaganda poster`,
    `${baseTerms} historical photograph`,
    `${baseTerms} primary source image archive`,
  ];

  const topicVocab = syllabusKeywordsFor(topic, learningOutcomes);
  const deadline = Date.now() + 8000;

  for (const query of queries) {
    if (Date.now() > deadline) break;
    let response;
    try {
      response = await tavilySearch(query, {
        excludeDomains: DENY_DOMAINS,
        maxResults: 12,
        includeImages: true,
        includeImageDescriptions: true,
      });
    } catch (e) {
      console.warn("[sources] image search exception", (e as Error).message);
      continue;
    }
    const { images, results } = response;
    if (!images || images.length === 0) continue;

    // Filter: real image URL, allow-listed host, not already used, not denied.
    const candidates = images
      .filter((im) => im.url && IMAGE_URL_RE.test(im.url))
      .filter((im) => isAllowed(im.url, ALLOW_DOMAINS_HUMANITIES, true))
      .filter((im) => !(usedHosts && usedHosts.has(hostnameOf(im.url))));

    if (candidates.length === 0) continue;

    // Rank: Tier-1 host + topic-keyword overlap in description boosts score.
    const ranked = candidates
      .map((im) => {
        const host = hostnameOf(im.url);
        const tier = humanitiesTier(host);
        const desc = (im.description ?? "").toLowerCase();
        let score = 0;
        if (tier === 1) score += 6;
        else if (tier === 2) score += 2;
        for (const kw of topicVocab) {
          if (kw.length >= 4 && desc.includes(kw)) score += 2;
        }
        if (/cartoon|poster|propaganda|photograph|portrait|engraving|painting/.test(desc)) score += 3;
        if (/logo|icon|avatar|sprite|banner|advert/.test(desc)) score -= 6;
        return { im, score, host };
      })
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score > 0);

    if (ranked.length === 0) continue;
    const best = ranked[0];

    // Find the page that contained the image, for a clean citation.
    const sourcePage = results.find((r) => hostnameOf(r.url) === best.host)?.url ?? best.im.url;
    const sourceTitle = results.find((r) => hostnameOf(r.url) === best.host)?.title
      ?? best.im.description?.slice(0, 120)
      ?? `${topic} — pictorial primary source`;

    if (usedHosts) usedHosts.add(best.host);

    return {
      kind: "image",
      image_url: best.im.url,
      caption: (best.im.description ?? "").trim().slice(0, 220) || `Pictorial source: ${topic}`,
      source_url: sourcePage,
      source_title: sourceTitle,
      publisher: publisherOf(sourcePage),
    };
  }

  return null;
}
