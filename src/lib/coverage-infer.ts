// Shared LO/KO/AO inference. Used by:
//   - src/routes/assessment.$id.tsx          (Coverage panel)
//   - supabase/functions/coach-review        (expanded tags before LLM call)
//   - supabase/functions/generate-assessment (post-pass before insert)
//
// The matcher only ADDS tags. It never removes a tag the LLM or teacher set.
// Now that every SBQ part and every essay carries a substantial L4 sample
// answer, content the student would have to DEPLOY to write that answer is
// treated as first-class evidence the LO/KO/AO is being tested — not just
// what the bare stem mentions.
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
 * Decide whether the question text (stem + sample answer + mark scheme)
 * demonstrates a given LO statement.
 *
 * Inclusive by design — under-tagging produces false "uncovered" warnings:
 *   - Threshold scales with the richness of the supporting text. A question
 *     that carries a substantial sample answer / mark scheme (≥60 content
 *     tokens) drops from 60% → 40% LO-token coverage, because the answer
 *     text proves the student WOULD deploy the LO to respond.
 *   - Short LOs (≤3 content tokens): require all 3, OR (when answer is
 *     rich) at least 2 of 3.
 *   - Proper-noun gate is softened: require AT LEAST half of the named
 *     entities in the LO to appear, not every single one. This stops
 *     multi-name LOs (e.g. "Hitler, Stalin and the Allies") from being
 *     blocked when only one named actor is referenced.
 */
export function questionMatchesLO(
  questionText: string,
  loStatement: string,
): boolean {
  if (!loStatement || !loStatement.trim()) return false;
  const loTokens = contentTokens(loStatement);
  if (loTokens.length === 0) return false;

  const qContentTokens = contentTokens(questionText);
  const qStems = stemSet(qContentTokens);
  const loStems = Array.from(stemSet(loTokens));

  // "Rich support" = stem + sample answer + mark scheme add up to a meaty
  // body the student must actually engage with.
  const richSupport = qContentTokens.length >= 60;

  // Proper nouns / rare named entities: tokens starting capitalised in the
  // LO AND not the very first word. Usually "Hitler", "Berlin", "Maluku",
  // "Newton", etc.
  const properNouns: string[] = [];
  const words = loStatement.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^A-Za-z0-9-]/g, "");
    if (!w) continue;
    if (i === 0) continue; // first word may just be sentence-cased
    if (/^[A-Z][a-z]{2,}/.test(w)) properNouns.push(w.toLowerCase());
  }
  if (properNouns.length > 0) {
    let pnHits = 0;
    for (const pn of properNouns) {
      if (qStems.has(stem(pn))) pnHits++;
    }
    // Single named entity: must appear (otherwise the question really is
    // about a different named topic). Multiple named entities: at least
    // half must appear.
    const requiredPnHits = properNouns.length === 1 ? 1 : Math.ceil(properNouns.length / 2);
    if (pnHits < requiredPnHits) return false;
  }

  let hits = 0;
  for (const ls of loStems) {
    if (qStems.has(ls)) hits++;
  }

  if (loStems.length <= 3) {
    // Short LOs: full match, or 2-of-3 when the question carries a rich
    // sample answer / mark scheme.
    if (hits === loStems.length) return true;
    if (richSupport && loStems.length === 3 && hits >= 2) return true;
    return false;
  }

  const ratio = hits / loStems.length;
  // Stem-only questions: keep the original 60% bar so we don't tag wildly.
  // Questions with a rich answer / mark scheme: drop to 40%.
  return ratio >= (richSupport ? 0.4 : 0.6);
}

// ───────────────────────── KO inference ─────────────────────────

const KO_VERBS: Record<string, string[]> = {
  Knowledge: [
    "state", "name", "list", "identify", "recall", "define", "label",
    "give", "what is", "what are",
  ],
  Understanding: [
    "describe", "explain", "summarise", "summarize", "outline", "discuss",
    "interpret", "illustrate", "classify", "distinguish", "account for",
    "suggest", "imply", "reveal", "indicate",
  ],
  Application: [
    "apply", "calculate", "compute", "use", "solve", "determine",
    "predict", "estimate", "construct", "complete", "infer", "deduce",
    "show that", "find", "draw on contextual", "draw on your contextual",
  ],
  Skills: [
    "compare", "contrast", "evaluate", "assess", "analyse", "analyze",
    "judge", "justify", "comment on", "to what extent", "how far",
    "how useful", "how reliable", "how similar", "how different",
    "weigh", "weighing", "examine the", "critically",
    "cross-reference", "cross reference",
    "balanced judgement", "reasoned judgement",
    "provenance", "bias", "motive", "limitations",
  ],
};

export function inferKOs(questionText: string, koPool: string[]): string[] {
  if (!koPool || koPool.length === 0) return [];
  const t = ` ${questionText.toLowerCase()} `;
  const out = new Set<string>();
  for (const ko of koPool) {
    const verbs = KO_VERBS[ko] ?? [];
    for (const v of verbs) {
      // Multi-word verbs / phrases: substring match. Single-word verbs:
      // word-boundary match (so "use" doesn't fire on "useful").
      const isPhrase = v.includes(" ") || v.includes("-");
      if (isPhrase) {
        if (t.includes(v)) { out.add(ko); break; }
      } else {
        if (
          t.includes(` ${v} `) || t.includes(` ${v}.`) || t.includes(` ${v},`) ||
          t.includes(` ${v}:`) || t.includes(` ${v}?`) || t.includes(` ${v};`)
        ) {
          out.add(ko);
          break;
        }
      }
    }
  }
  // A multi-mark structured / source-based / essay question almost always
  // involves Understanding once any explanation is required. If the stem +
  // answer matched Application or Skills, fold in Understanding too.
  if (out.has("Application") || out.has("Skills")) {
    if (koPool.includes("Understanding")) out.add("Understanding");
  }
  // Long-form prose (essays, SBQ sample answers) that names specific dates,
  // people, treaties or events implies Knowledge recall is being deployed.
  // Heuristic: ≥2 four-digit year tokens (1500–2099) OR ≥6 capitalised
  // proper-noun tokens → Knowledge engaged.
  if (koPool.includes("Knowledge") && !out.has("Knowledge")) {
    const yearHits = (questionText.match(/\b(1[5-9]\d{2}|20\d{2})\b/g) ?? []).length;
    const capHits = (questionText.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).length;
    if (yearHits >= 2 || capHits >= 6) out.add("Knowledge");
  }
  return Array.from(out);
}

// ───────────────────────── AO inference ─────────────────────────

// Bloom-verb / command-word → AO. Now expanded to catch verbs that surface
// in the L4 sample answer / mark scheme even when the stem itself is terse.
//
// We support BOTH the legacy 3-band tags (AO1/AO2/AO3) used by humanities-
// style syllabuses AND the granular MOE Combined Science 5086 codes
// (A1–A5 Knowledge with Understanding, B1–B7 Handling Information &
// Solving Problems, C1–C6 Experimental Skills) carried in
// syllabus_assessment_objectives. The pool drives the loop, so codes that
// are not in the syllabus's pool simply never fire.
const AO_VERBS_SCI: Record<string, string[]> = {
  AO1: ["state", "name", "list", "identify", "recall", "define", "label", "give"],
  AO2: ["calculate", "explain", "describe", "predict", "apply", "use", "determine", "show that", "estimate", "interpret", "account for"],
  AO3: ["analyse", "analyze", "evaluate", "assess", "compare", "design", "investigate", "plan", "justify", "weigh", "critique"],
  // ── 5086 / Combined Science granular AOs ─────────────────────────────
  // A series — Knowledge with Understanding
  A1: ["state", "name", "define", "describe", "explain", "outline", "phenomena", "law", "theory", "concept"],
  A2: ["symbol", "formula", "notation", "unit", "terminology", "vocabulary", "nuclide", "convention"],
  A3: ["apparatus", "burette", "pipette", "cylinder", "syringe", "technique", "instrument", "safety", "thermometer", "balance"],
  A4: ["mass", "volume", "temperature", "concentration", "determine", "measure", "quantity", "rate", "energy"],
  A5: ["application", "social", "economic", "environmental", "industrial", "fuel", "pollution", "atmosphere", "alloy", "polymer"],
  // B series — Handling Information & Solving Problems
  B1: ["locate", "select", "organise", "organize", "present", "from the", "given the"],
  B2: ["translate", "interpret", "convert", "graph", "chart", "table", "diagram"],
  B3: ["calculate", "manipulate", "compute", "stoichiometr", "moles of", "mol/dm"],
  B4: ["identify", "trend", "pattern", "infer", "deduce", "compare"],
  B5: ["explain", "account for", "reasoned", "relationship", "in terms of"],
  B6: ["predict", "propose", "hypothesis", "hypothesise", "hypothesize", "suggest"],
  B7: ["solve", "problem", "to find", "to determine"],
  // C series — Experimental Skills (Paper 5 only). Fire only on practical-
  // flavoured stems so theory papers don't accidentally tag them.
  C1: ["follow the procedure", "carry out", "step 1", "step 2", "instructions"],
  C2: ["apparatus", "set up", "set-up", "use the", "technique"],
  C3: ["record", "observe", "observation", "measurement", "estimate", "reading"],
  C4: ["interpret", "evaluate", "explain your", "from your results", "your observations"],
  C5: ["plan", "design an experiment", "select", "outline a procedure"],
  C6: ["evaluate", "improvement", "limitation", "modification", "extension", "improve"],
};
const AO_VERBS_HUM: Record<string, string[]> = {
  AO1: ["describe", "identify", "state", "list", "name", "outline", "recount"],
  AO2: ["explain", "account for", "why did", "why was", "suggest", "imply", "reveal"],
  AO3: [
    "infer", "compare", "how similar", "how different", "how far",
    "to what extent", "how useful", "how reliable", "what is the message",
    "what can you infer", "are you surprised", "evaluate", "assess",
    "judgement", "judgment", "provenance", "bias", "motive", "limitation",
    "cross-reference", "cross reference", "weighing", "weigh",
  ],
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
  // For humanities, an answer that visibly performs evaluation (provenance /
  // bias / weighing) almost always engages AO2 (explanation) too — the
  // student cannot evaluate without first explaining.
  if (subjectKind === "humanities" && out.has("AO3") && aoPool.includes("AO2")) {
    out.add("AO2");
  }
  // A long substantive answer that names specific factual content (years,
  // proper nouns) demonstrates AO1 knowledge recall, even when the stem is
  // a pure AO3 evaluation prompt.
  if (aoPool.includes("AO1") && !out.has("AO1")) {
    const yearHits = (questionText.match(/\b(1[5-9]\d{2}|20\d{2})\b/g) ?? []).length;
    const capHits = (questionText.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).length;
    if (yearHits >= 2 || capHits >= 6) out.add("AO1");
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
  // The supporting text the matcher reads is the FULL response surface the
  // student would have to construct: stem + sample answer + mark scheme +
  // topic + (MCQ) options. The L4 sample answer is treated as first-class
  // evidence — if the answer engages an LO, the question tests that LO
  // regardless of whether the stem mentions it explicitly.
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
