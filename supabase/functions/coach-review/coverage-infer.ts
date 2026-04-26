// Shared LO/KO/AO inference. Used by:
//   - src/routes/assessment.$id.tsx          (Coverage panel)
//   - supabase/functions/coach-review        (expanded tags before LLM call)
//   - supabase/functions/generate-assessment (post-pass before insert)
//
// The matcher only ADDS tags. It never removes a tag the LLM or teacher set.
// Goal: stop labelling LOs/KOs as "uncovered" when the question stem
// genuinely demonstrates them but the LLM only tagged the most central one.
//
// IMPORTANT: a near-duplicate of this file lives at
// supabase/functions/generate-assessment/coverage-infer.ts and at
// supabase/functions/coach-review/coverage-infer.ts because Deno edge
// functions cannot import from src/. Keep all three in sync.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
  "for", "with", "by", "from", "as", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "this", "that", "these",
  "those", "it", "its", "their", "they", "them", "we", "you", "i", "he", "she",
  "his", "her", "our", "your", "into", "than", "then", "so", "such", "can",
  "will", "should", "would", "could", "may", "might", "must", "shall", "not",
  "no", "yes", "any", "all", "some", "each", "every", "between", "within",
  "across", "during", "after", "before", "about", "while", "where", "when",
  "how", "why", "what", "which", "who", "whom", "whose", "include", "including",
  "e.g.", "eg", "etc", "etc.", "use", "using", "used", "upon", "via",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function contentTokens(s: string): string[] {
  return tokenize(s).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Cheap stem-of-stems: drop common suffixes so "industrialise" matches
// "industrialisation" and "explained" matches "explain".
function stem(t: string): string {
  let x = t;
  for (const suf of ["ising", "izing", "isation", "ization", "ations", "ation", "ising", "ically", "ation", "ising", "ings", "ied", "ies", "ing", "ers", "ed", "es", "er", "ly", "s"]) {
    if (x.length > suf.length + 3 && x.endsWith(suf)) { x = x.slice(0, -suf.length); break; }
  }
  return x;
}

function stemSet(tokens: string[]): Set<string> {
  return new Set(tokens.map(stem));
}

/**
 * Decide whether the question text demonstrates a given LO statement.
 *
 * Rule: at least 60% of the LO's content tokens (stemmed) appear in the
 * question text, AND any clearly proper-noun token (capitalised in the
 * original LO) appears verbatim. We default to inclusive: if an LO is short
 * (<= 3 content tokens), we require ALL of them to match.
 */
export function questionMatchesLO(
  questionText: string,
  loStatement: string,
): boolean {
  if (!loStatement || !loStatement.trim()) return false;
  const loTokens = contentTokens(loStatement);
  if (loTokens.length === 0) return false;

  const qStems = stemSet(contentTokens(questionText));
  const loStems = Array.from(stemSet(loTokens));

  // Proper nouns / rare named entities: tokens starting capitalised in the LO
  // AND not the very first word. These are usually "Hitler", "Berlin",
  // "Maluku", "Newton", etc. We require those to appear.
  const properNouns: string[] = [];
  const words = loStatement.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^A-Za-z0-9-]/g, "");
    if (!w) continue;
    if (i === 0) continue; // first word may just be sentence-cased
    if (/^[A-Z][a-z]{2,}/.test(w)) properNouns.push(w.toLowerCase());
  }
  for (const pn of properNouns) {
    if (!qStems.has(stem(pn))) return false;
  }

  let hits = 0;
  for (const ls of loStems) {
    if (qStems.has(ls)) hits++;
  }

  if (loStems.length <= 3) return hits === loStems.length;
  return hits / loStems.length >= 0.6;
}

// ───────────────────────── KO inference ─────────────────────────

const KO_VERBS: Record<string, string[]> = {
  Knowledge: [
    "state", "name", "list", "identify", "recall", "define", "label",
    "give", "what is", "what are",
  ],
  Understanding: [
    "describe", "explain", "summarise", "summarize", "outline", "discuss",
    "interpret", "illustrate", "classify", "distinguish",
  ],
  Application: [
    "apply", "calculate", "compute", "use", "solve", "determine",
    "predict", "estimate", "construct", "complete", "infer", "deduce",
    "show that", "find",
  ],
  Skills: [
    "compare", "contrast", "evaluate", "assess", "analyse", "analyze",
    "judge", "justify", "comment on", "to what extent", "how far",
    "how useful", "how reliable", "how similar", "how different",
    "weigh", "examine the", "critically",
  ],
};

export function inferKOs(questionText: string, koPool: string[]): string[] {
  if (!koPool || koPool.length === 0) return [];
  const t = ` ${questionText.toLowerCase()} `;
  const out = new Set<string>();
  for (const ko of koPool) {
    const verbs = KO_VERBS[ko] ?? [];
    for (const v of verbs) {
      if (t.includes(` ${v} `) || t.includes(` ${v}.`) || t.includes(` ${v},`) || t.includes(` ${v}:`) || t.includes(` ${v}?`)) {
        out.add(ko);
        break;
      }
    }
  }
  // A multi-mark structured / source-based question almost always involves
  // Understanding once any explanation is required. If the stem already
  // matched Application or Skills, fold in Understanding too.
  if (out.has("Application") || out.has("Skills")) {
    if (koPool.includes("Understanding")) out.add("Understanding");
  }
  return Array.from(out);
}

// ───────────────────────── AO inference ─────────────────────────

// Bloom-verb / command-word → AO. Matches the heuristics already used by
// coach-review/index.ts (sciences vs humanities split).
const AO_VERBS_SCI: Record<string, string[]> = {
  AO1: ["state", "name", "list", "identify", "recall", "define", "label", "give"],
  AO2: ["calculate", "explain", "describe", "predict", "apply", "use", "determine", "show that", "estimate"],
  AO3: ["analyse", "analyze", "evaluate", "assess", "compare", "design", "investigate", "plan", "justify"],
};
const AO_VERBS_HUM: Record<string, string[]> = {
  AO1: ["describe", "identify", "state", "list", "name"],
  AO2: ["explain", "account for", "why did", "why was"],
  AO3: ["infer", "compare", "how similar", "how different", "how far", "to what extent", "how useful", "how reliable", "what is the message", "what can you infer", "are you surprised"],
};

export function inferAOs(
  questionText: string,
  aoPool: string[],
  subjectKind: "humanities" | "english" | "science_math" | "other",
): string[] {
  if (!aoPool || aoPool.length === 0) return [];
  const map = subjectKind === "humanities" ? AO_VERBS_HUM : AO_VERBS_SCI;
  const t = ` ${questionText.toLowerCase()} `;
  const out = new Set<string>();
  for (const ao of aoPool) {
    const verbs = map[ao] ?? [];
    for (const v of verbs) {
      if (t.includes(v)) { out.add(ao); break; }
    }
  }
  return Array.from(out);
}

// ───────────────────────── Top-level expansion ─────────────────────────

export type InferInput = {
  stem: string;
  answer?: string | null;
  mark_scheme?: string | null;
  topic?: string | null;
  options?: string[] | null;
};

export type Pools = {
  loPool: string[];
  koPool: string[];
  aoPool: string[];
};

export type ExpandedTags = {
  ao_codes: string[];
  knowledge_outcomes: string[];
  learning_outcomes: string[];
};

export function expandQuestionTags(
  q: InferInput,
  current: ExpandedTags,
  pools: Pools,
  subjectKind: "humanities" | "english" | "science_math" | "other",
): ExpandedTags {
  const text = [
    q.stem ?? "",
    q.answer ?? "",
    q.mark_scheme ?? "",
    q.topic ?? "",
    Array.isArray(q.options) ? q.options.join(" ") : "",
  ].join(" \n ");

  const inferredLOs = pools.loPool.filter((lo) => questionMatchesLO(text, lo));
  const inferredKOs = inferKOs(text, pools.koPool);
  const inferredAOs = inferAOs(text, pools.aoPool, subjectKind);

  const merge = (a: string[], b: string[]) => {
    const set = new Set<string>();
    for (const x of a) if (typeof x === "string" && x.trim()) set.add(x);
    for (const x of b) if (typeof x === "string" && x.trim()) set.add(x);
    return Array.from(set);
  };

  return {
    ao_codes: merge(current.ao_codes ?? [], inferredAOs),
    knowledge_outcomes: merge(current.knowledge_outcomes ?? [], inferredKOs),
    learning_outcomes: merge(current.learning_outcomes ?? [], inferredLOs),
  };
}
