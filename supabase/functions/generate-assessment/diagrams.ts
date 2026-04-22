// Hybrid diagram sourcing for Science / Math questions.
// Cascade: past-paper repository → Firecrawl (allow-listed) → Nano Banana Pro AI generation → null.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { tavilySearch, hasTavily } from "../_shared/tavily.ts";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

export type DiagramSource = "past_paper" | "web" | "ai_generated";

export type DiagramResult = {
  url: string;
  source: DiagramSource;
  citation: string | null;
  caption: string;
};

export type ScienceMathKind = "math" | "physics" | "chemistry" | "biology" | "general_science" | null;

export function classifyScienceMath(subject: string | null | undefined): ScienceMathKind {
  if (!subject) return null;
  const s = subject.toLowerCase();
  if (s.includes("math")) return "math";
  if (s.includes("physics")) return "physics";
  if (s.includes("chemistry")) return "chemistry";
  if (s.includes("biology")) return "biology";
  if (s.includes("science")) return "general_science";
  return null;
}

/** Heuristic: do we want to attempt a diagram for this row? */
export function questionWantsDiagram(
  kind: ScienceMathKind,
  questionTypes: string[],
  topic: string,
  learningOutcomes: string[],
  stem: string = "",
): boolean {
  if (!kind) return false;
  const blob = (topic + " " + learningOutcomes.join(" ")).toLowerCase();
  const stemBlob = (stem ?? "").toLowerCase();

  // Skip for purely descriptive / non-visual topics, even in science.
  const descriptiveOnly = [
    "definition", "definitions", "history of", "etymology", "naming convention",
    "social impact", "ethical", "discussion of", "essay on",
  ];
  if (descriptiveOnly.some((k) => blob.includes(k))) return false;

  const isScience = kind === "physics" || kind === "chemistry" || kind === "biology" || kind === "general_science";
  const heavyTypes = ["structured", "source_based", "practical", "comprehension"];
  const lightTypes = ["mcq", "short_answer"];

  // Visual keywords that, when present in the STEM, strongly imply the question
  // is referring to an image the student is expected to look at.
  const stemVisualPhrases = [
    "diagram below", "diagram shows", "diagram above", "the diagram",
    "figure below", "figure shows", "figure above", "the figure", "fig.",
    "circuit shown", "circuit below", "the circuit",
    "apparatus shown", "apparatus below", "the apparatus", "set-up shown", "setup shown",
    "graph shows", "graph below", "the graph", "shown in the graph",
    "shown below", "shown above", "shown in fig",
    "ray diagram", "energy profile", "structure shown", "structure of",
    "as shown", "is shown", "are shown",
  ];
  const stemHasVisualRef = stemVisualPhrases.some((k) => stemBlob.includes(k));

  // SCIENCE: default-on for structured/practical/comprehension/source_based questions
  // (these are the slots where MOE specimen papers consistently feature apparatus,
  // circuits, ray paths, biological structures, etc.).
  if (isScience && questionTypes.some((t) => heavyTypes.includes(t))) return true;

  // SCIENCE MCQ / short-answer: only fire when the STEM itself references a visual.
  // MOE Paper 1 (MCQ) frequently has text-only items; we don't want to force a
  // diagram on every MCQ, only those that explicitly refer to one.
  if (isScience && questionTypes.some((t) => lightTypes.includes(t)) && stemHasVisualRef) return true;

  // MATH or non-science fallback: require a heavy type AND a visual keyword.
  const visualKeywords = [
    "diagram", "graph", "circuit", "apparatus", "structure", "cell", "anatomy",
    "force", "ray", "lens", "mirror", "wave", "field", "molecule", "bond",
    "geometry", "triangle", "angle", "coordinate", "axis", "plot", "vector",
    "ecosystem", "food web", "organ", "plant", "animal", "reaction", "energy profile",
    "titration", "distillation", "set-up", "setup", "shape", "solid", "net",
    "fraction", "bar model", "number line", "pie chart", "histogram",
    "circuit diagram", "apparatus", "bunsen", "test tube", "beaker", "alkene",
    "ammeter", "voltmeter", "pulley", "spring", "pendulum", "convex", "concave",
  ];
  const hasVisualKeyword = visualKeywords.some((k) => blob.includes(k) || stemBlob.includes(k));

  if (questionTypes.some((t) => heavyTypes.includes(t)) && hasVisualKeyword) return true;

  // MCQ / short-answer (non-science): only when topic OR stem mentions a visual.
  if (questionTypes.some((t) => lightTypes.includes(t)) && hasVisualKeyword) return true;

  // Math/physics structured: default-yes (formulas often paired with figures).
  if ((kind === "math" || kind === "physics") && questionTypes.includes("structured")) return true;

  return false;
}

// Allow-list for science/math web searches.
const ALLOW_DOMAINS_SCIENCE_MATH = [
  // SG official
  "seab.gov.sg", "moe.gov.sg",
  // CC-licensed / open educational
  "khanacademy.org", "openstax.org", "ck12.org", "phet.colorado.edu",
  // Math-specific
  "nrich.maths.org", "mathsisfun.com", "geogebra.org", "desmos.com",
  // Science encyclopedias / labs
  "britannica.com", "bbc.co.uk", "nasa.gov", "noaa.gov",
  "sciencelearn.org.nz", "biologycorner.com", "chem.libretexts.org",
  "physicsclassroom.com", "splung.com",
];

const DENY_DOMAINS = [
  "wikipedia.org", "wikiwand.com", "quora.com", "reddit.com",
  "medium.com", "blogspot.com", "wordpress.com", "substack.com",
  "tumblr.com", "pinterest.com",
];

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
function publisherOf(url: string): string {
  return hostnameOf(url).replace(/^www\./, "");
}
function isDenied(url: string): boolean {
  const h = hostnameOf(url);
  if (!h) return true;
  return DENY_DOMAINS.some((d) => h.endsWith(d) || h.includes(d));
}
function isAllowed(url: string): boolean {
  const h = hostnameOf(url);
  if (!h) return false;
  if (isDenied(url)) return false;
  // The plan is to allow all math/science sites but exclude Wikipedia/blogs.
  // We allow anything not denied, with a soft preference for the curated allow-list.
  return true;
}
function isOnAllowList(url: string): boolean {
  const h = hostnameOf(url);
  return ALLOW_DOMAINS_SCIENCE_MATH.some((d) => h === d || h.endsWith("." + d) || h.endsWith(d));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: search the past-paper diagram repository.
// ─────────────────────────────────────────────────────────────────────────────

async function fromPastPapers(
  supabase: ReturnType<typeof createClient>,
  topic: string,
  learningOutcomes: string[],
  subject: string,
  level: string,
  stem: string,
): Promise<DiagramResult | null> {
  // Build a tag-pool from topic + LOs + stem snippet.
  const tags = (topic + " " + learningOutcomes.join(" ") + " " + stem.slice(0, 200))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  if (tags.length === 0) return null;

  // Try subject + level first; fall back to subject-only when level has no hits.
  let { data: papers } = await supabase
    .from("past_papers")
    .select("id, title, exam_board, year, paper_number")
    .eq("subject", subject)
    .eq("level", level)
    .limit(50);
  if (!papers || papers.length === 0) {
    const r = await supabase
      .from("past_papers")
      .select("id, title, exam_board, year, paper_number")
      .eq("subject", subject)
      .limit(50);
    papers = r.data;
  }
  const paperIds = (papers ?? []).map((p) => (p as { id: string }).id);
  if (paperIds.length === 0) return null;

  // Pull candidate diagrams; rank by tag + caption overlap and prefer specimen/sample papers.
  const { data: diagrams } = await supabase
    .from("past_paper_diagrams")
    .select("id, paper_id, image_path, caption, topic_tags, page_number")
    .in("paper_id", paperIds)
    .limit(200);
  if (!diagrams || diagrams.length === 0) return null;

  type Paper = { id: string; title: string; exam_board: string | null; year: number | null; paper_number: string | null };
  const paperById = new Map<string, Paper>();
  for (const p of (papers ?? []) as Paper[]) paperById.set(p.id, p);

  type Diag = {
    id: string; paper_id: string; image_path: string; caption: string | null;
    topic_tags: string[] | null; page_number: number | null;
  };
  const ranked = (diagrams as Diag[])
    .map((d) => {
      const dtags = (d.topic_tags ?? []).map((t) => t.toLowerCase());
      const caption = (d.caption ?? "").toLowerCase();
      let score = 0;
      // Tag overlap (high signal).
      score += dtags.filter((t) => tags.some((q) => t.includes(q) || q.includes(t))).length * 2;
      // Caption keyword overlap.
      for (const t of tags) {
        if (t.length > 3 && caption.includes(t)) score += 1;
      }
      // Specimen / sample paper boost.
      const title = (paperById.get(d.paper_id)?.title ?? "").toLowerCase();
      if (title.includes("specimen") || title.includes("sample")) score += 5;
      // Penalise diagrams that still point at the source PDF (un-cropped legacy rows).
      if (d.image_path.startsWith("papers/")) score -= 3;
      return { d, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;

  const best = ranked[0].d;
  const paper = paperById.get(best.paper_id);

  // Resolve a public URL for the image.
  const url = await resolveStorageUrl(supabase, best.image_path);
  if (!url) return null;

  const citation = paper
    ? `${paper.exam_board ?? "Past paper"} ${paper.year ?? ""} ${paper.title} Paper ${paper.paper_number ?? ""}`.replace(/\s+/g, " ").trim()
    : "Past paper (uploaded)";
  return {
    url,
    source: "past_paper",
    citation,
    caption: best.caption ?? "Figure from uploaded past paper",
  };
}

async function resolveStorageUrl(
  supabase: ReturnType<typeof createClient>,
  path: string,
): Promise<string | null> {
  // path format: "<bucket>/<key>" or just "<key>" (defaults to diagrams bucket).
  let bucket = "diagrams";
  let key = path;
  const slash = path.indexOf("/");
  if (slash > 0) {
    const maybeBucket = path.slice(0, slash);
    if (["diagrams", "papers"].includes(maybeBucket)) {
      bucket = maybeBucket;
      key = path.slice(slash + 1);
    }
  }
  if (bucket === "diagrams") {
    const pub = supabase.storage.from(bucket).getPublicUrl(key);
    return pub.data.publicUrl ?? null;
  }
  // Private bucket → signed URL valid for 7 days.
  const { data } = await supabase.storage.from(bucket).createSignedUrl(key, 60 * 60 * 24 * 7);
  return data?.signedUrl ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Web search for a labelled figure (Tavily first, Firecrawl fallback).
// ─────────────────────────────────────────────────────────────────────────────

async function fromTavilyImages(
  kind: Exclude<ScienceMathKind, null>,
  topic: string,
  learningOutcomes: string[],
): Promise<DiagramResult | null> {
  if (!hasTavily()) return null;
  const lo = learningOutcomes[0] ?? "";
  const subjectWord = kind === "general_science" ? "science" : kind;
  const query = `${topic} ${lo} ${subjectWord} diagram labelled exam`.trim();

  const { images, results } = await tavilySearch(query, {
    includeDomains: ALLOW_DOMAINS_SCIENCE_MATH,
    excludeDomains: DENY_DOMAINS,
    maxResults: 10,
    includeImages: true,
    includeImageDescriptions: true,
  });

  // Prefer images whose URL is on the allow-list and looks like a real raster/svg.
  const ranked = images
    .filter((im) => /\.(png|jpe?g|gif|svg|webp)(\?|#|$)/i.test(im.url))
    .filter((im) => !isDenied(im.url))
    .map((im) => {
      let score = 0;
      if (isOnAllowList(im.url)) score += 5;
      const blob = ((im.description ?? "") + " " + im.url).toLowerCase();
      const topicWords = topic.toLowerCase().split(/\s+/);
      for (const w of topicWords) if (w.length > 3 && blob.includes(w)) score += 2;
      if (/diagram|figure|fig\.|circuit|graph|chart|model|setup|apparatus/.test(blob)) score += 3;
      if (/logo|icon|avatar|sprite|banner|ad/.test(blob)) score -= 5;
      return { im, score };
    })
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;
  const best = ranked[0].im;
  // Find a matching textual result for citation context.
  const host = hostnameOf(best.url);
  const sourcePage = results.find((r) => hostnameOf(r.url) === host)?.url ?? best.url;
  return {
    url: best.url,
    source: "web",
    citation: `${publisherOf(sourcePage)} — ${sourcePage}`,
    caption: best.description || `${topic} diagram`,
  };
}

async function fromFirecrawl(
  kind: Exclude<ScienceMathKind, null>,
  topic: string,
  learningOutcomes: string[],
): Promise<DiagramResult | null> {
  if (!FIRECRAWL_API_KEY) return null;
  const lo = learningOutcomes[0] ?? "";
  const subjectWord = kind === "general_science" ? "science" : kind;
  const query = `${topic} ${lo} ${subjectWord} diagram labelled exam`.trim();

  const resp = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 10 }),
  });
  if (!resp.ok) {
    console.warn("[diagrams] firecrawl search failed", resp.status);
    return null;
  }
  const json = await resp.json();
  const results = json?.data?.web ?? json?.web ?? json?.data ?? [];
  type SR = { url?: string; link?: string; title?: string };
  const candidates: { url: string; title: string }[] = [];
  for (const r of results as SR[]) {
    const url = r.url ?? r.link;
    if (typeof url !== "string") continue;
    if (!isAllowed(url)) continue;
    candidates.push({ url, title: r.title ?? "" });
  }
  // Sort candidates with on-allow-list URLs first.
  candidates.sort((a, b) => Number(isOnAllowList(b.url)) - Number(isOnAllowList(a.url)));

  for (const cand of candidates.slice(0, 4)) {
    try {
      const scrape = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: cand.url, formats: ["html", "markdown"], onlyMainContent: true }),
      });
      if (!scrape.ok) continue;
      const sjson = await scrape.json();
      const data = sjson?.data ?? sjson;
      const html: string = data?.html ?? "";
      const markdown: string = data?.markdown ?? "";
      const img = pickBestImage(html, markdown, cand.url, topic);
      if (!img) continue;
      return {
        url: img.src,
        source: "web",
        citation: `${publisherOf(cand.url)} — ${cand.url}`,
        caption: img.alt || cand.title || `${topic} diagram`,
      };
    } catch (e) {
      console.warn("[diagrams] scrape error", cand.url, e);
    }
  }
  return null;
}

/** Web tier: try Tavily image search first, then Firecrawl scrape-and-pick. */
async function fromWeb(
  kind: Exclude<ScienceMathKind, null>,
  topic: string,
  learningOutcomes: string[],
): Promise<DiagramResult | null> {
  const t = await fromTavilyImages(kind, topic, learningOutcomes);
  if (t) return t;
  return fromFirecrawl(kind, topic, learningOutcomes);
}

/** Pick the largest <img> matching topic keywords; fall back to first image. */
function pickBestImage(
  html: string, markdown: string, pageUrl: string, topic: string,
): { src: string; alt: string } | null {
  const found: { src: string; alt: string; score: number }[] = [];
  // From HTML: collect <img src alt>.
  const imgRe = /<img[^>]*?src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const rawSrc = m[1];
    const alt = (m[2] ?? "").trim();
    if (!rawSrc) continue;
    if (rawSrc.startsWith("data:")) continue;
    const abs = resolveUrl(rawSrc, pageUrl);
    if (!abs) continue;
    if (!/\.(png|jpe?g|gif|svg|webp)(\?|#|$)/i.test(abs)) continue;
    let score = 0;
    const blob = (alt + " " + abs).toLowerCase();
    const topicWords = topic.toLowerCase().split(/\s+/);
    for (const w of topicWords) if (w.length > 3 && blob.includes(w)) score += 2;
    if (/diagram|figure|fig\.|circuit|graph|chart|model|setup|apparatus/.test(blob)) score += 3;
    if (/logo|icon|avatar|sprite|banner|ad/.test(blob)) score -= 5;
    found.push({ src: abs, alt, score });
  }
  // From markdown: ![alt](src)
  const mdRe = /!\[([^\]]*)\]\(([^)\s]+)/g;
  while ((m = mdRe.exec(markdown)) !== null) {
    const src = resolveUrl(m[2], pageUrl);
    if (!src) continue;
    if (!/\.(png|jpe?g|gif|svg|webp)(\?|#|$)/i.test(src)) continue;
    found.push({ src, alt: (m[1] ?? "").trim(), score: 1 });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => b.score - a.score);
  return { src: found[0].src, alt: found[0].alt };
}

function resolveUrl(href: string, base: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: AI generation via Nano Banana Pro (google/gemini-3-pro-image-preview).
// ─────────────────────────────────────────────────────────────────────────────

async function fromAI(
  supabase: ReturnType<typeof createClient>,
  kind: Exclude<ScienceMathKind, null>,
  subject: string,
  level: string,
  topic: string,
  learningOutcomes: string[],
  stem: string,
  assessmentId: string,
): Promise<DiagramResult | null> {
  if (!LOVABLE_API_KEY) return null;
  const lo = learningOutcomes[0] ?? "";
  const subjectName = subject || (kind === "general_science" ? "Science" : kind);
  const levelName = level || "Secondary";
  const stemSnippet = (stem ?? "").trim().slice(0, 320);

  const prompt = `Generate a Singapore MOE ${levelName} ${subjectName} exam-style diagram for a question.
Topic: ${topic}
${lo ? `Learning outcome: ${lo}` : ""}
${stemSnippet ? `Question context: ${stemSnippet}` : ""}

Requirements:
- Clean black-and-white line art only (no shading, no colour, no gradients).
- White background.
- Clear, legible labels in plain sans-serif (component names, axes, units).
- Match the visual conventions used in Singapore O-Level / PSLE past papers.
- No watermarks, no captions, no decorative elements.
- Diagram only — no question text.`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!resp.ok) {
      console.warn("[diagrams] AI generation failed", resp.status, await resp.text());
      return null;
    }
    const json = await resp.json();
    const dataUrl: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl?.startsWith("data:")) return null;

    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma); // e.g. "image/png;base64"
    const b64 = dataUrl.slice(comma + 1);
    const contentType = meta.split(";")[0] || "image/png";
    const ext = contentType.split("/")[1] ?? "png";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const key = `ai/${assessmentId}/${crypto.randomUUID()}.${ext}`;
    const upload = await supabase.storage.from("diagrams").upload(key, bytes, {
      contentType, upsert: false,
    });
    if (upload.error) {
      console.warn("[diagrams] upload failed", upload.error);
      return null;
    }
    const pub = supabase.storage.from("diagrams").getPublicUrl(key);
    if (!pub.data.publicUrl) return null;
    return {
      url: pub.data.publicUrl,
      source: "ai_generated",
      citation: null,
      caption: `${topic} (AI-generated diagram)`,
    };
  } catch (e) {
    console.warn("[diagrams] AI exception", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entrypoint: run the cascade.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchDiagram(opts: {
  supabase: ReturnType<typeof createClient>;
  kind: Exclude<ScienceMathKind, null>;
  subject: string;
  level: string;
  topic: string;
  learningOutcomes: string[];
  stem?: string;
  assessmentId: string;
}): Promise<DiagramResult | null> {
  const stem = opts.stem ?? "";
  // 1. Past papers
  try {
    const r = await fromPastPapers(opts.supabase, opts.topic, opts.learningOutcomes, opts.subject, opts.level, stem);
    if (r) return r;
  } catch (e) { console.warn("[diagrams] past_papers stage error", e); }

  // 2. Web (Tavily images → Firecrawl fallback)
  try {
    const r = await fromWeb(opts.kind, opts.topic, opts.learningOutcomes);
    if (r) return r;
  } catch (e) { console.warn("[diagrams] web stage error", e); }

  // 3. AI generation
  try {
    const r = await fromAI(opts.supabase, opts.kind, opts.subject, opts.level, opts.topic, opts.learningOutcomes, stem, opts.assessmentId);
    if (r) return r;
  } catch (e) { console.warn("[diagrams] ai stage error", e); }

  return null;
}
