import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { fetchGroundedSource, fetchGroundedImageSource, fetchGroundedImageSources, classifySubject, humanitiesTier, type GroundedSource, type GroundedImageSource, type TierBudget } from "./sources.ts";
import { generateProvenances } from "./provenance.ts";
import { fetchDiagram, classifyScienceMath, questionWantsDiagram } from "./diagrams.ts";
import { fetchExemplars } from "./exemplars.ts";
import { expandQuestionTags } from "./coverage-infer.ts";
import { buildDifficultyRubricBlock } from "../_shared/difficulty.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ---------- Types ----------

type SectionTopic = {
  topic: string;
  topic_code?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
  /** Discipline label e.g. "Physics", "Chemistry", "Practical". Used to enforce
   *  50/50 splits on multi-track papers like Combined Science 5086 Paper 1. */
  section?: string | null;
};

type DifficultyMix = { easy: number; medium: number; hard: number };

type Section = {
  id?: string;
  letter: string;
  name?: string;
  question_type: string;
  marks: number;
  num_questions: number;
  bloom?: string;
  sbq_skill?: string;
  sbq_skills?: string[];
  topic_pool: SectionTopic[];
  instructions?: string;
  difficulty_mix?: DifficultyMix;
  /** Per-section objective targets — narrow the global picks. */
  ao_codes?: string[];
  knowledge_outcomes?: string[];
  learning_outcomes?: string[];
};

function normalizeGeneratedOptions(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null;
  return options.map((opt) => {
    if (typeof opt === "string") return opt;
    if (opt && typeof opt === "object") {
      const rec = opt as Record<string, unknown>;
      const label = typeof rec.key === "string" ? rec.key : null;
      const text = [rec.text, rec.value, rec.label].find((v) => typeof v === "string") as string | undefined;
      return [label, text].filter(Boolean).join(". ") || JSON.stringify(opt);
    }
    return String(opt ?? "");
  }).filter(Boolean);
}

/** Largest-remainder rounding: turn a percentage mix into an array of n difficulty labels. */
function assignDifficultyToQuestions(
  mix: DifficultyMix | undefined | null,
  n: number,
): ("easy" | "medium" | "hard")[] {
  if (n <= 0) return [];
  const fallback: ("easy" | "medium" | "hard")[] = Array(n).fill("medium");
  if (!mix) return fallback;
  const total = (mix.easy || 0) + (mix.medium || 0) + (mix.hard || 0);
  if (total <= 0) return fallback;
  const levels: ("easy" | "medium" | "hard")[] = ["easy", "medium", "hard"];
  const raw = {
    easy: ((mix.easy || 0) / total) * n,
    medium: ((mix.medium || 0) / total) * n,
    hard: ((mix.hard || 0) / total) * n,
  };
  const counts: Record<"easy" | "medium" | "hard", number> = {
    easy: Math.floor(raw.easy),
    medium: Math.floor(raw.medium),
    hard: Math.floor(raw.hard),
  };
  let assigned = counts.easy + counts.medium + counts.hard;
  // Distribute remaining slots by largest fractional remainder.
  const remainders = levels
    .map((l) => ({ l, frac: raw[l] - Math.floor(raw[l]) }))
    .sort((a, b) => b.frac - a.frac);
  let ri = 0;
  while (assigned < n) {
    counts[remainders[ri % 3].l]++;
    assigned++;
    ri++;
  }
  // Build a deterministic interleaved sequence: easy, medium, hard repeating
  // until each level's count is exhausted, so adjacent questions vary.
  const out: ("easy" | "medium" | "hard")[] = [];
  while (out.length < n) {
    for (const l of levels) {
      if (counts[l] > 0) {
        out.push(l);
        counts[l]--;
        if (out.length >= n) break;
      }
    }
  }
  return out;
}

// SBQ skill definitions mirrored from src/lib/sections.ts
type SbqSkillDef = {
  id: string;
  label: string;
  marks: number[];
  default: number;
  locked: boolean;
  minSources: number;
  promptHeader: string;
  markScheme: string;
};

// History SBQ skills, mapped to the SEAB AO3 command-word taxonomy.
// Each `promptHeader` lists 2–3 phrasings drawn DIRECTLY from the syllabus
// "Command Words / Notes" column so generated stems read like the real paper.
// Each `markScheme` is a Level of Response Marking Scheme (LORMS): candidates
// are AWARDED for attempts at different ways of analysing and reaching a
// reasoned conclusion, not penalised for not landing the perfect answer.
const SBQ_SKILLS: Record<string, SbqSkillDef> = {
  inference: {
    id: "inference", label: "Inference", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 1,
    promptHeader: `Write an INFERENCE question (AO3.2 — drawing inferences from given information). The student MUST go BEYOND surface description to reason about what the source SUGGESTS / IMPLIES / REVEALS — never a content-recall question. Use ONE of these SEAB inference command-word stems verbatim:
  • "What can you infer from Source A about [topic]? Explain your answer using details from the source."
  • "What is the message of Source A about [topic]? Explain your answer using details of the source."
  • "What does Source A suggest about [topic]? Explain your answer using details of the source."
The student must make an INFERENCE (e.g. about attitudes, motives, perspectives, intent, contemporary opinion — NOT literal recall) and support it with a quoted detail from Source A. FORBIDDEN openings: "What does Source A describe / show / depict / list …", "What characteristics / features does Source A …", "According to Source A, what …".`,
    markScheme: `LORMS — award the highest level the candidate's response REACHES; reward attempts at inferring even when evidence is thin.
L1 (1m): Lifts/copies surface details from the source without inferring. Award if any attempt is made to engage with the source.
L2 (2–3m): Attempts a valid inference but supporting evidence from the source is missing, vague, or one-sided.
L3 (4–5m): Makes a valid inference and supports it with specific evidence quoted or paraphrased from Source A. Reward attempts at a reasoned reading of the source.
L4 (6+m): Makes TWO well-supported inferences, each with precise quoted evidence from Source A, and reaches a reasoned overall conclusion about what the source reveals.`,
  },
  purpose: {
    id: "purpose", label: "Purpose", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 1,
    promptHeader: `Write a PURPOSE question (AO3.5 — recognising values and detecting bias). Use ONE of these SEAB command-word stems verbatim:
  • "What is the purpose of Source A? Explain your answer using details of the source and your contextual knowledge."
  • "Why was Source A produced? Explain your answer using details of the source and your contextual knowledge."
  • "Do you think [named individual or group] would have agreed with Source A? Explain your answer using details of the source and your contextual knowledge."
The student must identify the author's intended purpose (persuade, warn, glorify, justify, reassure, etc.) and ground it in BOTH the source content AND its provenance.`,
    markScheme: `LORMS — reward attempts to move from describing content to analysing intent.
L1 (1m): Describes the source's content with no attempt at purpose. Award for any attempt to engage.
L2 (2–3m): Asserts a purpose but justifies it with EITHER provenance OR content alone, without linking the two.
L3 (4–5m): States a plausible purpose supported by EITHER detailed provenance (author, audience, date, context) OR specific content evidence, with the beginnings of a reasoned argument.
L4 (6+m): States a plausible purpose supported by BOTH provenance AND content evidence, drawing on contextual knowledge to reach a reasoned conclusion about why Source A was created.`,
  },
  comparison: {
    id: "comparison", label: "Comparison", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 2,
    promptHeader: `Write a COMPARISON question (AO3.3 — comparing and contrasting different views). Use ONE of these SEAB command-word stems verbatim, choosing the one that best fits the two sources:
  • "How similar are Sources A and B? Explain your answer."
  • "How different are Sources A and B? Explain your answer."
  • "How far are Sources A and B similar in their views about [topic]? Explain your answer."
The student must compare BOTH message AND tone/provenance across the two sources.`,
    markScheme: `LORMS — reward attempts at comparison even when the candidate only manages similarities OR differences.
L1 (1–2m): Identifies only surface similarities or differences (e.g. "both are about X"). Award for any attempt to engage with both sources.
L2 (3–4m): Identifies similarities OR differences in message with evidence drawn from both sources.
L3 (5–6m): Identifies BOTH similarities AND differences in message, with specific evidence from both sources, and begins to reason about why the views differ.
L4 (7–8m): Compares BOTH message AND tone/provenance, with quoted evidence from both sources, and reaches a reasoned judgement on overall similarity that weighs the strength of each comparison.`,
  },
  utility: {
    id: "utility", label: "Utility", marks: [6, 7, 8], default: 7, locked: false, minSources: 1,
    promptHeader: `Write a UTILITY question (AO3.6 — establishing utility of given information). Use ONE of these SEAB command-word stems verbatim:
  • "How useful is Source A as evidence about [topic]? Explain your answer."
  • "How far does Source B prove Source A wrong about [topic]? Explain your answer."
The student must evaluate utility from BOTH the content AND the provenance, and acknowledge limitations.`,
    markScheme: `LORMS — reward attempts to weigh usefulness rather than asserting it.
L1 (1–2m): States useful/not useful with little or no justification. Award for any attempt to engage with the source's evidential value.
L2 (3–4m): Evaluates utility from content OR provenance alone, without acknowledging limitations.
L3 (5–6m): Evaluates utility from BOTH content AND provenance with specific evidence; begins to acknowledge what the source cannot show.
L4 (7–8m): Evaluates utility from content AND provenance, acknowledges clear limitations, and reaches a reasoned overall judgement about how far Source A is useful as evidence about the topic.`,
  },
  reliability: {
    id: "reliability", label: "Reliability", marks: [6, 7, 8], default: 7, locked: false, minSources: 1,
    promptHeader: `Write a RELIABILITY question (AO3.4 — distinguishing between facts, opinion and judgement). Use ONE of these SEAB command-word stems verbatim:
  • "How reliable is Source A as evidence about [topic]? Explain your answer."
  • "How far can we trust Source A about [topic]? Explain your answer."
  • "How accurate is Source A about [topic]? Explain your answer."
  • "How far does Source B prove Source A wrong? Explain your answer."
The student must cross-reference the source's content against contextual knowledge AND analyse its provenance for bias.`,
    markScheme: `LORMS — reward attempts to weigh content against provenance, even when one side is stronger than the other.
L1 (1–2m): States reliable/unreliable with little or no justification. Award for any attempt to engage with reliability.
L2 (3–4m): Evaluates reliability via content cross-reference OR provenance/bias alone.
L3 (5–6m): Evaluates reliability via content cross-reference AND provenance/bias, with specific evidence and the beginnings of a reasoned weighting.
L4 (7–8m): Evaluates reliability via content cross-reference, provenance AND bias, with a reasoned, balanced overall judgement on how far Source A can be trusted.`,
  },
  surprise: {
    id: "surprise", label: "Surprise", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 1,
    promptHeader: `Write a SURPRISE question (AO3.4 / AO3.5 — facts vs opinion, values and bias). Use the SEAB command-word stem verbatim:
  • "Are you surprised by Source A? Explain your answer."
The student must explain what IS surprising AND what is NOT surprising, both grounded in contextual knowledge AND in the source's content/provenance.`,
    markScheme: `LORMS — reward attempts to consider both sides of surprise.
L1 (1m): States surprised/not surprised with little or no justification. Award for any attempt to engage.
L2 (2–3m): Explains EITHER surprise OR non-surprise using either source content or contextual knowledge alone.
L3 (4–5m): Explains BOTH surprise AND non-surprise using contextual knowledge, with at least one side anchored in the source.
L4 (6+m): Explains BOTH surprise AND non-surprise with detailed contextual knowledge AND source evidence (content + provenance), reaching a reasoned, balanced judgement.`,
  },
  assertion: {
    id: "assertion", label: "Assertion (Hypothesis)", marks: [8], default: 8, locked: true, minSources: 3,
    promptHeader: `Write an ASSERTION (HYPOTHESIS) question worth EXACTLY 8 marks (AO3.7 — drawing conclusions based on a reasoned consideration of evidence and arguments). Use the SEAB command-word stem verbatim:
  • "'[State a clear, debatable historical hypothesis about the topic]'. How far do Sources A, B, C, D, E [and F if six sources] support this assertion? Use ALL the sources to explain your answer."
The hypothesis MUST be a debatable claim. The student must use EVERY source provided, evaluating which support and which challenge the hypothesis, and reach a reasoned overall conclusion.`,
    markScheme: `LORMS — reward attempts to use the FULL source set to reach a reasoned conclusion, even when evaluation of source quality is uneven.
L1 (1–2m): Uses only one or two sources; asserts agree/disagree without evaluation. Award for any attempt to engage with the assertion using the sources.
L2 (3–4m): Uses MOST sources; identifies which support and which challenge the assertion but does not judge their relative weight.
L3 (5–6m): Uses ALL sources; identifies support and challenge with specific evidence, and begins to evaluate source quality (provenance / bias), reaching a partial reasoned conclusion.
L4 (7–8m): Uses ALL sources; evaluates BOTH support AND challenge with evidence, weighs source quality (provenance + bias) across the set, and reaches a substantiated, reasoned overall judgement on how far the assertion is supported.`,
  },
};

// Per-skill L4 sample-answer guidance for SBQs. The `answer` field on each
// generated SBQ MUST be a fully written candidate-voice exemplar that hits
// the L4 descriptors of the skill's LORMS — not a meta-description like
// "A strong answer would…". These blocks are injected into the section
// prompt so the model knows what an L4 response actually looks like.
const SBQ_SAMPLE_ANSWER_GUIDANCE: Record<string, string> = {
  inference: `INFERENCE L4 sample answer (write into the answer field, in the candidate's voice — NEVER "a strong answer would…"):
  - 2–3 short paragraphs, ~150–220 words.
  - Make TWO distinct, valid inferences about the topic (about attitudes / motives / perspectives / contemporary opinion / unstated assumptions — NOT literal recall).
  - Support EACH inference with a SHORT direct quotation (in quotation marks) lifted verbatim from Source A.
  - Close with a one-sentence reasoned overall conclusion about what Source A reveals.
  - DO NOT describe the source's content; INTERPRET it.`,
  purpose: `PURPOSE L4 sample answer (candidate's voice, ~180–250 words):
  - State a plausible specific purpose (persuade / warn / glorify / justify / reassure / discredit / mobilise) in the opening sentence.
  - Provenance paragraph: cite the AUTHOR, the AUDIENCE, the DATE, and the immediate CONTEXT to explain WHY the source was produced; bring in 1–2 specific contextual facts.
  - Content paragraph: quote 1–2 short phrases from Source A that betray the purpose (loaded language, framing, what is omitted).
  - End with a reasoned conclusion linking provenance + content to the stated purpose.`,
  comparison: `COMPARISON L4 sample answer (candidate's voice, ~220–320 words for 7–8 mark parts):
  - Paragraph 1 — SIMILARITY in MESSAGE: identify a shared message, with a SHORT quoted phrase from EACH of Sources A and B.
  - Paragraph 2 — DIFFERENCE in MESSAGE: identify a clear difference, again with a SHORT quoted phrase from EACH source.
  - Paragraph 3 — TONE / PROVENANCE comparison: compare HOW each source argues (tone, register, what each emphasises) and link this to provenance (author, audience, date).
  - Conclusion: a reasoned overall judgement on how far the two sources agree, weighing whether the message-similarity or the tone/provenance-difference is more significant.`,
  utility: `UTILITY L4 sample answer (candidate's voice, ~250–350 words):
  - Opening: a one-line judgement on how useful Source A is as evidence about the topic.
  - CONTENT paragraph: quote specific details from Source A and explain what they tell us about the topic.
  - PROVENANCE paragraph: identify author / audience / date / type of source and explain how each makes the source MORE or LESS useful.
  - LIMITATIONS paragraph: explicitly state what Source A CANNOT show — what is missing, what perspective is absent, what the format constrains.
  - Conclusion: a reasoned overall judgement that weighs content + provenance + limitations to decide how far Source A is useful.`,
  reliability: `RELIABILITY L4 sample answer (candidate's voice, ~250–350 words):
  - Opening: a one-line judgement on how reliable Source A is.
  - CROSS-REFERENCE paragraph: take 1–2 specific claims from Source A and weigh them against your contextual knowledge (named events, dates, statistics, named individuals) — do they corroborate or contradict?
  - PROVENANCE paragraph: author, audience, date — does the provenance support trust or undermine it?
  - BIAS / MOTIVE paragraph: identify whose interest the source serves; quote loaded or selective language; note what is conspicuously omitted.
  - Conclusion: a balanced, reasoned overall judgement (not a flat "reliable / unreliable") on how far Source A can be trusted as evidence about the topic.`,
  surprise: `SURPRISE L4 sample answer (candidate's voice, ~180–260 words):
  - Paragraph 1 — what IS surprising: name the surprising element, anchor it in BOTH a quoted detail from Source A AND a specific piece of contextual knowledge that makes it unexpected.
  - Paragraph 2 — what is NOT surprising: explain what the source says that fits the wider historical context, again grounded in BOTH source detail AND contextual knowledge (and reference provenance where relevant — author, audience, date).
  - Conclusion: a reasoned, balanced judgement on whether you are MORE surprised or LESS surprised overall, and why.`,
  assertion: `ASSERTION (HYPOTHESIS) L4 sample answer (candidate's voice, ~350–500 words for the 8-mark part):
  - Opening: state your overall judgement on how far the sources support the assertion.
  - SUPPORT paragraph(s): group the sources that SUPPORT the assertion; for EACH cite a SHORT quoted phrase or specific detail and explain how it supports.
  - CHALLENGE paragraph(s): group the sources that CHALLENGE the assertion; for EACH cite a SHORT quoted phrase or specific detail and explain how it challenges.
  - SOURCE-QUALITY paragraph: weigh provenance + bias across the set — which sources are more credible / more partial, and how that affects the weight of their evidence.
  - Conclusion: a substantiated overall judgement that uses EVERY source (Sources A, B, C, D, E) and reaches a reasoned position on how far the assertion holds.`,
};

// ---------- History Section B (essay) — SEAB-style L1–L4 mark scheme + model essay ----------
// Section B essays are TWO-FACTOR analytical questions (e.g. "How far / To what
// extent / Which was more important"). The mark scheme below mirrors the SEAB
// O-Level / N(A)-Level History Elective marking ladder the user specified.
const HISTORY_ESSAY_MARK_SCHEME = `LEVEL DESCRIPTORS (copy these four lines VERBATIM into the mark_scheme field, then add 1–2 indicative-content bullets per level tailored to THIS specific question):

L1 (1–2 marks): Describes without focus on the question.
L2 (3–4 marks): Describes one or both factors with details, without explanation.
L3 (5–8 marks): Explains one or both factors with explanation. Maximum 6 marks if only ONE factor is explained; 7–8 marks requires BOTH factors explained with detail.
L4 (9–10 marks): L3 + a clear, detailed evaluation reaching a substantiated overall judgement (e.g. weighs which factor was more decisive, or distinguishes necessary vs sufficient causes, or short-term vs long-term).

LEVEL-AWARDING GUIDANCE (apply when writing the indicative-content bullets):
  - "Describe" = states what happened (events, dates, names) without saying WHY it mattered to the question.
  - "Explain" = links the factor causally to the outcome named in the question, using historical reasoning ("This led to … because …", "As a result …").
  - "Evaluate" = compares the two factors against each other and reaches a reasoned judgement (most important / decisive / interconnected / triggering vs underlying).`;

const HISTORY_ESSAY_ANSWER_TEMPLATE = `MODEL ESSAY (write the answer field as a complete student exemplar of ~400–600 words, structured EXACTLY as below — separate EVERY paragraph with a BLANK LINE so paragraph breaks survive rendering):

  1. INTRODUCTION (1 short paragraph): Define key terms in the question. Identify the TWO factors that will be discussed. State a preliminary stand on the question (which factor you will argue is more important, or your overall judgement on the "How far / To what extent" prompt).

  2. FACTOR 1 — PEEL paragraph:
     • Point: Name the factor and assert its contribution to the outcome.
     • Evidence: At least 4 specific historical references — dates, named individuals, named events, organisations, statistics, treaty/policy names.
     • Explanation: Link the evidence causally to the question. Show HOW and WHY this factor produced the outcome.
     • Mini-link: One sentence tying the paragraph back to the question.

  3. FACTOR 2 — PEEL paragraph (same structure for the second/contrasting factor): At least 4 specific historical references.

  4. EVALUATION paragraph: Weigh Factor 1 against Factor 2. Use one clear evaluative framework — e.g. more important vs less important, necessary vs sufficient, trigger vs underlying cause, short-term vs long-term, or interconnected (one enabled the other). Reach a reasoned overall judgement supported by the evidence already given.

  5. CONCLUSION (1–2 sentences): Restate the substantiated judgement.

FORMATTING — the answer field MUST contain at least 5 distinct paragraphs separated by blank lines (\\n\\n between paragraphs). Do NOT cram the whole essay into one block. Do NOT use bullet points in the final answer — write flowing prose paragraphs.

QUALITY BAR — the answer must demonstrate L4-level historical analysis so it is usable as a model exemplar for students. Do NOT write a generic outline; write a fully developed essay with concrete, accurate historical detail throughout.`;

// Resolve effective skill IDs for a section, supporting new sbq_skills array
// and legacy single sbq_skill. Caps at 5 and filters unknown ids.
function resolveEffectiveSkills(section: Section): string[] {
  const raw = Array.isArray(section.sbq_skills) && section.sbq_skills.length > 0
    ? section.sbq_skills
    : (section.sbq_skill ? [section.sbq_skill] : []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (!id || seen.has(id) || !SBQ_SKILLS[id]) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 5) break;
  }
  return out;
}

// Distribute selected skills across the section's question slots.
// Assertion (locked) always takes exactly 1 slot if selected; remaining slots
// are filled round-robin from the other selected skills.
function assignSkillsToQuestions(skills: SbqSkillDef[], numQuestions: number): (SbqSkillDef | null)[] {
  if (skills.length === 0 || numQuestions <= 0) {
    return Array(numQuestions).fill(null);
  }
  const assertion = skills.find((s) => s.id === "assertion");
  const others = skills.filter((s) => s.id !== "assertion");
  const slots: (SbqSkillDef | null)[] = [];
  if (assertion) {
    // Assertion takes the LAST slot (so earlier slots use single sources).
    for (let i = 0; i < numQuestions - 1; i++) {
      const pick = others.length > 0 ? others[i % others.length] : assertion;
      slots.push(pick);
    }
    slots.push(assertion);
  } else {
    for (let i = 0; i < numQuestions; i++) {
      slots.push(others[i % others.length]);
    }
  }
  return slots;
}

// Per-skill stem templates drawn from the SEAB AO3 "Command Words / Notes"
// taxonomy. The deterministic builder rotates through these so consecutive
// papers don't read like clones. {S1}/{S2}/{ALL} are filled at render time.
const SBQ_STEM_TEMPLATES: Record<string, string[]> = {
  inference: [
    `Study Source {S1}. ({P}) What can you infer from Source {S1} about {T}? Explain your answer using details from the source.`,
    `Study Source {S1}. ({P}) What is the message of Source {S1} about {T}? Explain your answer using details of the source.`,
    `Study Source {S1}. ({P}) What does Source {S1} suggest about {T}? Explain your answer using details of the source.`,
  ],
  comparison: [
    `Study Sources {S1} and {S2}. ({P}) How similar are Sources {S1} and {S2} in their views about {T}? Explain your answer.`,
    `Study Sources {S1} and {S2}. ({P}) How different are Sources {S1} and {S2} about {T}? Explain your answer.`,
    `Study Sources {S1} and {S2}. ({P}) How far are Sources {S1} and {S2} similar in their views about {T}? Explain your answer.`,
  ],
  reliability: [
    `Study Source {S1}. ({P}) How reliable is Source {S1} as evidence about {T}? Explain your answer.`,
    `Study Source {S1}. ({P}) How far can we trust Source {S1} about {T}? Explain your answer.`,
    `Study Source {S1}. ({P}) How accurate is Source {S1} about {T}? Explain your answer.`,
    `Study Sources {S1} and {S2}. ({P}) How far does Source {S2} prove Source {S1} wrong? Explain your answer.`,
  ],
  utility: [
    `Study Source {S1}. ({P}) How useful is Source {S1} as evidence about {T}? Explain your answer.`,
    `Study Sources {S1} and {S2}. ({P}) How far does Source {S2} prove Source {S1} wrong about {T}? Explain your answer.`,
  ],
  purpose: [
    `Study Source {S1}. ({P}) What is the purpose of Source {S1}? Explain your answer using details of the source and your contextual knowledge.`,
    `Study Source {S1}. ({P}) Why was Source {S1} produced? Explain your answer using details of the source and your contextual knowledge.`,
  ],
  surprise: [
    `Study Source {S1}. ({P}) Are you surprised by Source {S1}? Explain your answer.`,
  ],
  assertion: [
    `Study Sources {ALL}. ({P}) "{T} was shaped mainly by the actions of the major powers involved." How far do Sources {ALL} support this assertion? Use ALL the sources to explain your answer.`,
  ],
};

/** Themed primary-source bundles for MOE Sec History inquiry topics.
 *  Each bundle has a topic-keyword regex; a topic matches if EITHER the topic
 *  string OR any LO contains a keyword from its trigger set. Bundles can match
 *  multiply (e.g. "Cold War" + "decolonisation") and are merged. */
type CuratedBundle = {
  trigger: RegExp;
  sources: GroundedSource[];
};

const CURATED_HUMANITIES_BUNDLES: CuratedBundle[] = [
  // --- WWII outbreak / appeasement ---
  {
    trigger: /(world war ii|wwii|second world war|outbreak of war|appeasement|munich|league of nations|abyssinia|rhineland|anschluss|non-aggression pact|invasion of poland)/i,
    sources: [
      { excerpt: `In September 1938, the British Prime Minister Neville Chamberlain returned from Munich and told the public that the agreement over Czechoslovakia had brought "peace for our time". He argued that Britain had avoided a war for which many ordinary people were not ready, and that disputes between nations should be settled by negotiation rather than force. To supporters, the agreement showed that statesmen could prevent another catastrophe like the First World War. To critics, it showed that Britain and France had accepted Hitler's demands and encouraged further aggression by sacrificing Czechoslovakia without its full consent.`, source_url: "https://avalon.law.yale.edu/imt/munich1.asp", source_title: "Munich Agreement, 1938", publisher: "Avalon Project" },
      { excerpt: `In March 1936, German troops entered the Rhineland, an area that Germany had agreed to keep demilitarised under the Treaty of Versailles and the Locarno Treaties. Hitler presented the move as Germany merely entering its own territory and claimed that Germany wanted peace with its neighbours. The remilitarisation was popular in Germany because it appeared to restore national pride after Versailles. Britain and France protested but did not use force. The lack of military response made Germany's position stronger and suggested that treaty restrictions could be challenged without immediate consequences.`, source_url: "https://www.nationalarchives.gov.uk/education/resources/interwar/", source_title: "German remilitarisation of the Rhineland", publisher: "UK National Archives" },
      { excerpt: `The League of Nations' response to Italy's invasion of Abyssinia in 1935 exposed serious weaknesses in collective security. The League condemned the invasion and imposed sanctions, but these did not include oil and did not stop Italy's campaign. Britain and France were reluctant to act too strongly because they hoped to keep Mussolini as a possible ally against Hitler. The crisis damaged the League's credibility: a major power had used force against a weaker state, and the international organisation set up to prevent aggression had failed to protect it effectively.`, source_url: "https://www.nationalarchives.gov.uk/education/resources/league-of-nations/", source_title: "League of Nations and the Abyssinian Crisis", publisher: "UK National Archives" },
      { excerpt: `In the German-Soviet Non-Aggression Pact of August 1939, Germany and the Soviet Union promised not to attack one another. A secret protocol divided parts of Eastern Europe into German and Soviet spheres of influence, including arrangements over Poland. The pact shocked many observers because Nazi Germany and the communist Soviet Union were ideological enemies. For Hitler, it reduced the danger of fighting a war on two fronts if Germany attacked Poland. For Stalin, it bought time and offered territorial gains. The agreement removed a major obstacle to German action in Eastern Europe.`, source_url: "https://avalon.law.yale.edu/20th_century/nonagres.asp", source_title: "German-Soviet Non-Aggression Pact, 1939", publisher: "Avalon Project" },
      { excerpt: `After Germany invaded Poland on 1 September 1939, Britain issued an ultimatum demanding German withdrawal. When no satisfactory reply was received, Britain declared war on Germany on 3 September. In his broadcast, Chamberlain said that Hitler had rejected all efforts for a peaceful settlement and had attacked an independent country that Britain had promised to support. The declaration suggested that appeasement had reached its limit: Britain could no longer accept further German expansion without destroying its own credibility and the European balance of power.`, source_url: "https://www.nationalarchives.gov.uk/education/resources/chamberlain-and-hitler/", source_title: "Britain declares war on Germany, 1939", publisher: "UK National Archives" },
    ],
  },

  // --- Rise of Nazism / Weimar Germany / authoritarian rule in Germany ---
  {
    trigger: /(nazi|nazism|hitler|weimar|reichstag|enabling act|third reich|nuremberg laws|authoritarian.*germany|rise of authoritarian|fascis)/i,
    sources: [
      { excerpt: `On 30 January 1933, President Paul von Hindenburg appointed Adolf Hitler as Chancellor of Germany. Hitler led the largest party in the Reichstag but did not have a majority. Conservative politicians around Hindenburg believed they could control Hitler by surrounding him with non-Nazi ministers. The appointment came after months of political deadlock and a series of short-lived governments. Many Germans hoped a Hitler-led coalition would restore stability after years of economic depression and political violence; others warned that handing the chancellorship to the Nazi leader was a dangerous gamble.`, source_url: "https://encyclopedia.ushmm.org/content/en/article/the-nazi-rise-to-power", source_title: "Hindenburg appoints Hitler Chancellor, January 1933", publisher: "United States Holocaust Memorial Museum" },
      { excerpt: `On the night of 27 February 1933, the German Reichstag building was destroyed by fire. The Nazi government blamed a communist conspiracy. The next day, President Hindenburg signed the Decree of the Reich President for the Protection of People and State, suspending most civil liberties guaranteed by the Weimar Constitution, including freedom of the press, freedom of assembly, and protection from arbitrary arrest. The decree allowed the Nazi regime to arrest political opponents, especially communists, and to silence opposition newspapers in the weeks before the March 1933 election.`, source_url: "https://encyclopedia.ushmm.org/content/en/article/the-reichstag-fire", source_title: "Reichstag Fire Decree, 28 February 1933", publisher: "United States Holocaust Memorial Museum" },
      { excerpt: `The Law to Remedy the Distress of People and Reich, known as the Enabling Act, was passed by the Reichstag on 23 March 1933. It allowed Hitler's cabinet to issue laws without the approval of the Reichstag or the President for four years, including laws that conflicted with the constitution. The vote took place in an atmosphere of intimidation: communist deputies had already been arrested, SA stormtroopers surrounded the building, and only the Social Democrats voted against. The act effectively ended parliamentary democracy in Germany and gave Hitler a legal basis for dictatorship.`, source_url: "https://encyclopedia.ushmm.org/content/en/article/enabling-act", source_title: "The Enabling Act, March 1933", publisher: "United States Holocaust Memorial Museum" },
      { excerpt: `Following the death of President Hindenburg on 2 August 1934, Hitler combined the offices of Chancellor and President and took the title Führer. Members of the German armed forces were required to swear a personal oath of loyalty not to the constitution but to "Adolf Hitler, the Führer of the German Reich and people". This new oath bound the army directly to Hitler as an individual rather than to the state, removing one of the last institutional checks on his power.`, source_url: "https://encyclopedia.ushmm.org/content/en/article/the-fuehrer-oath", source_title: "Oath of Loyalty to Hitler, August 1934", publisher: "United States Holocaust Memorial Museum" },
      { excerpt: `The Weimar Republic faced repeated crises from its founding in 1919: the loss of the First World War, the punitive terms of the Treaty of Versailles, hyperinflation in 1923, and mass unemployment after the 1929 Wall Street Crash. By 1932, more than six million Germans were unemployed, and street battles between Nazi and Communist paramilitaries were a regular occurrence. Many voters lost faith in democratic parties and turned to extremist movements that promised order, work and national renewal. The Nazi Party's vote share rose from 2.6% in 1928 to 37.4% in July 1932.`, source_url: "https://www.nationalarchives.gov.uk/education/resources/weimar-republic/", source_title: "The fall of the Weimar Republic", publisher: "UK National Archives" },
      { excerpt: `Joseph Goebbels, appointed Reich Minister of Public Enlightenment and Propaganda in March 1933, used radio, film, posters and mass rallies to project a single image of Hitler as the saviour of Germany. The regime distributed cheap "People's Receivers" so that Hitler's speeches could reach as many homes as possible, while opposition newspapers were shut down or absorbed. Propaganda presented economic recovery, public works such as the Autobahn, and rearmament as evidence that authoritarian rule was succeeding where the Weimar parties had failed.`, source_url: "https://www.bbc.co.uk/bitesize/guides/zqksgdm/revision/1", source_title: "Nazi propaganda and the consolidation of power", publisher: "BBC Bitesize" },
    ],
  },

  // --- Stalinist USSR / authoritarian rule in the Soviet Union ---
  {
    trigger: /(stalin|soviet union|ussr|five-year plan|collectivisation|collectivization|gulag|great purge|show trial|authoritarian.*soviet|authoritarian.*russia|bolshevik)/i,
    sources: [
      { excerpt: `In January 1933, Stalin told the Central Committee of the Communist Party that the First Five-Year Plan had been completed in four years and three months. He claimed that the Soviet Union had been transformed from an agrarian into an industrial country. Steel, coal and electricity output had risen sharply, and entire new industrial cities such as Magnitogorsk had been built from nothing. Stalin presented these results as proof that planned socialist industry could outperform capitalism, especially during the Great Depression. He did not mention the famine then unfolding in Ukraine and other grain-producing regions.`, source_url: "https://www.marxists.org/reference/archive/stalin/works/1933/01/07.htm", source_title: "Stalin: Results of the First Five-Year Plan, 1933", publisher: "Marxists Internet Archive" },
      { excerpt: `Collectivisation, launched in 1929, forced Soviet peasants to give up their land, animals and tools and join state-controlled collective farms (kolkhozy). Peasants who resisted, especially better-off farmers labelled "kulaks", were arrested, deported to Siberia or shot. Grain was requisitioned to feed cities and to export for industrial machinery. In 1932–33, requisitioning combined with poor harvests produced a famine in which several million people died, particularly in Ukraine, the North Caucasus and Kazakhstan. The state denied the famine and continued to export grain throughout the crisis.`, source_url: "https://www.britannica.com/event/Soviet-famine-of-1932-33", source_title: "The Soviet Famine of 1932–33", publisher: "Encyclopaedia Britannica" },
      { excerpt: `Between 1936 and 1938, the Soviet leadership organised three large public "show trials" of leading Old Bolsheviks in Moscow. The defendants confessed to fantastic charges of conspiring with foreign powers, plotting to assassinate Stalin and sabotaging Soviet industry. Most were executed shortly afterwards. Confessions had been extracted by long interrogations, threats against families and torture. The trials gave a public, judicial face to a much wider campaign — the Great Terror — in which the secret police (NKVD) arrested roughly 1.5 million people, executing over 680,000 of them.`, source_url: "https://www.bbc.co.uk/bitesize/guides/z7t87p3/revision/1", source_title: "The Show Trials and Great Terror", publisher: "BBC Bitesize" },
      { excerpt: `The Gulag was a system of forced-labour camps run by the Soviet secret police. By the late 1930s it held more than a million prisoners, including ordinary criminals, peasants accused of resisting collectivisation, members of national minorities and people convicted of political "crimes" under Article 58 of the criminal code. Prisoners worked on canals, railways, mines and timber camps in remote regions of Siberia and the Arctic. Conditions were harsh and death rates from cold, hunger and disease were high. The camps both terrorised the population and supplied cheap labour for Stalin's industrialisation drive.`, source_url: "https://www.gulag.online/articles/an-introduction-to-the-gulag", source_title: "The Soviet Gulag system", publisher: "Gulag Online (Memorial)" },
      { excerpt: `Soviet propaganda built a "cult of personality" around Stalin. Newspapers, schoolbooks, films and posters portrayed him as the wise teacher of the peoples, the natural successor to Lenin and the architect of every Soviet success. Cities, factories and mountains were renamed in his honour. Public criticism was effectively impossible: even casual jokes about Stalin could lead to arrest under article 58, paragraph 10, of the criminal code. The cult helped present authoritarian rule as the personal expression of the wisdom of one man.`, source_url: "https://www.nationalarchives.gov.uk/education/resources/stalin/", source_title: "The Stalin cult of personality", publisher: "UK National Archives" },
    ],
  },

  // --- Cold War origins ---
  {
    trigger: /(cold war|truman doctrine|marshall plan|long telegram|iron curtain|berlin blockade|berlin airlift|nato|warsaw pact|containment|ideological polari|superpower rivalry)/i,
    sources: [
      { excerpt: `In February 1946, George Kennan, the American chargé d'affaires in Moscow, sent an 8,000-word telegram to Washington. He argued that Soviet leaders believed in an unending struggle between capitalism and communism, and that the USSR would expand its influence wherever it could without risking war. Kennan recommended that the United States respond with "long-term, patient but firm and vigilant containment of Russian expansive tendencies". The telegram became the intellectual foundation of US Cold War policy.`, source_url: "https://www.trumanlibrary.gov/library/research-files/telegram-george-kennan-james-byrnes-long-telegram", source_title: "Kennan's Long Telegram, February 1946", publisher: "Truman Library" },
      { excerpt: `Speaking at Westminster College in Fulton, Missouri, in March 1946, Winston Churchill declared: "From Stettin in the Baltic to Trieste in the Adriatic, an iron curtain has descended across the Continent. Behind that line lie all the capitals of the ancient states of Central and Eastern Europe... all are subject in one form or another, not only to Soviet influence but to a very high and, in some cases, increasing measure of control from Moscow." The speech publicly framed Europe as already divided into two hostile blocs.`, source_url: "https://winstonchurchill.org/resources/speeches/1946-1963-elder-statesman/the-sinews-of-peace/", source_title: "Churchill's 'Iron Curtain' speech, March 1946", publisher: "International Churchill Society" },
      { excerpt: `Addressing Congress on 12 March 1947, President Harry Truman asked for $400 million in aid for Greece and Turkey, then under pressure from communist insurgents and Soviet demands. He stated: "I believe that it must be the policy of the United States to support free peoples who are resisting attempted subjugation by armed minorities or by outside pressures." This commitment, soon known as the Truman Doctrine, generalised American support to any state threatened by communism and marked an open break with the wartime alliance.`, source_url: "https://avalon.law.yale.edu/20th_century/trudoc.asp", source_title: "Truman Doctrine address, March 1947", publisher: "Avalon Project" },
      { excerpt: `In June 1947, US Secretary of State George Marshall proposed a programme of large-scale economic aid to help Europe recover from the war. Marshall said that American policy was "directed not against any country or doctrine but against hunger, poverty, desperation and chaos". The European Recovery Program, soon called the Marshall Plan, eventually delivered around $13 billion in grants and loans to sixteen Western European states between 1948 and 1952. The Soviet Union refused to participate and forbade Eastern European governments from accepting aid, deepening the division of Europe.`, source_url: "https://www.oecd.org/general/themarshallplanspeechatharvarduniversity5june1947.htm", source_title: "Marshall Plan speech, Harvard, June 1947", publisher: "OECD" },
      { excerpt: `In June 1948, the Soviet Union closed all road, rail and canal routes from the Western occupation zones of Germany into West Berlin in an attempt to force the Western Allies out of the city. The United States and Britain responded with the Berlin Airlift, flying in food, fuel and supplies on a continuous basis for almost a year. At its peak, an aircraft landed in West Berlin every minute. Stalin lifted the blockade in May 1949 without achieving his objective. The crisis confirmed the East–West split and led directly to the formation of NATO that same year.`, source_url: "https://history.state.gov/milestones/1945-1952/berlin-airlift", source_title: "The Berlin Blockade and Airlift, 1948–49", publisher: "US Department of State, Office of the Historian" },
      { excerpt: `In September 1947, at the founding meeting of the Cominform in Poland, Soviet ideologist Andrei Zhdanov declared that the post-war world had split into "two camps": an "imperialist and anti-democratic camp" led by the United States, and a "democratic and anti-imperialist camp" led by the USSR. Zhdanov accused the Marshall Plan of being a tool to subordinate Europe to American capital. The Two-Camps doctrine became the official Soviet justification for tightening control over Eastern Europe and breaking with former wartime allies.`, source_url: "https://digitalarchive.wilsoncenter.org/document/zhdanovs-speech-cominform", source_title: "Zhdanov's 'Two Camps' speech, 1947", publisher: "Wilson Center Digital Archive" },
    ],
  },

  // --- End of the Cold War / collapse of the USSR ---
  {
    trigger: /(end of the cold war|gorbachev|perestroika|glasnost|reagan|tear down this wall|fall of the berlin wall|collapse of the (ussr|soviet union)|decline of the (ussr|soviet union)|arms race|reykjavik|inf treaty)/i,
    sources: [
      { excerpt: `Speaking to the 27th Party Congress in Moscow in February 1986, Mikhail Gorbachev called for "radical reform" of the Soviet economy. He admitted that growth had stalled and that Soviet industry lagged badly behind Western technology. The reforms he proposed — perestroika (restructuring) and uskorenie (acceleration) — sought to make state enterprises more responsive to consumer demand and to reduce central planning. Critics inside the party warned that loosening controls might unravel the socialist system; supporters argued that reform was the only way to preserve it.`, source_url: "https://digitalarchive.wilsoncenter.org/document/gorbachev-political-report-27th-congress", source_title: "Gorbachev's report to the 27th Party Congress, 1986", publisher: "Wilson Center Digital Archive" },
      { excerpt: `Standing at the Brandenburg Gate in West Berlin on 12 June 1987, US President Ronald Reagan addressed the Soviet leadership directly: "General Secretary Gorbachev, if you seek peace, if you seek prosperity for the Soviet Union and Eastern Europe, if you seek liberalisation: come here to this gate. Mr Gorbachev, open this gate. Mr Gorbachev, tear down this wall!" The speech framed the Berlin Wall as the visible symbol of an unfree system and put public pressure on the Soviet Union to match its rhetoric of openness with action.`, source_url: "https://www.reaganlibrary.gov/archives/speech/remarks-east-west-relations-brandenburg-gate-west-berlin", source_title: "Reagan at the Brandenburg Gate, June 1987", publisher: "Ronald Reagan Presidential Library" },
      { excerpt: `In December 1987 in Washington, Reagan and Gorbachev signed the Intermediate-Range Nuclear Forces (INF) Treaty. It was the first arms-control agreement to eliminate an entire class of nuclear weapons: all American and Soviet land-based missiles with ranges between 500 and 5,500 kilometres. The treaty included on-site inspections of each side's missile bases — an unprecedented level of intrusion into Soviet territory. The agreement marked a dramatic step away from the arms race that had defined US–Soviet relations for decades.`, source_url: "https://2009-2017.state.gov/t/avc/trty/102360.htm", source_title: "INF Treaty, December 1987", publisher: "US Department of State" },
      { excerpt: `On the evening of 9 November 1989, an East German official announced at a televised press conference that East Germans could cross the inner-German border "immediately". Within hours, large crowds gathered at checkpoints in Berlin. Overwhelmed border guards opened the gates and East Germans poured into West Berlin for the first time since 1961. Within days, sections of the Wall were being broken open by the public. The fall of the Wall became the symbolic end of the division of Europe and accelerated the collapse of communist regimes across the Eastern Bloc.`, source_url: "https://www.bbc.co.uk/news/world-europe-50013048", source_title: "The fall of the Berlin Wall, November 1989", publisher: "BBC News" },
      { excerpt: `On 25 December 1991, Mikhail Gorbachev resigned as President of the Soviet Union and the hammer-and-sickle flag was lowered over the Kremlin for the last time. In his television address, Gorbachev said the country had inherited "many achievements" but that "the old system collapsed before the new one had time to start working". By the end of the day, the USSR had ceased to exist; in its place stood fifteen independent republics. Both supporters and critics agreed that Gorbachev's reforms — intended to save Soviet socialism — had unintentionally accelerated its end.`, source_url: "https://www.cnn.com/world/cold-war/episodes/24/script.html", source_title: "Gorbachev's resignation address, December 1991", publisher: "CNN Cold War Series Archive" },
    ],
  },

  // --- Decolonisation in Southeast Asia / Singapore independence ---
  {
    trigger: /(decolonisation|decolonization|singapore|merger|separation|lee kuan yew|malaysia|self-government|british withdrawal|konfrontasi|federation of malaya)/i,
    sources: [
      { excerpt: `Announcing the merger of Singapore, Malaya, Sabah and Sarawak on 16 September 1963, Tunku Abdul Rahman declared the formation of Malaysia. The merger was presented as the natural decolonisation outcome for the region: it would end British colonial rule in the territories, provide Singapore with a wider economic hinterland, and combine the populations of the Federation, Singapore and the Borneo states in a single multi-racial state. The British government supported merger as a way of withdrawing from its remaining Southeast Asian responsibilities while keeping the region out of communist control.`, source_url: "https://www.nas.gov.sg/archivesonline/speeches/record-details/7269b6e6-115d-11e3-83d5-0050568939ad", source_title: "Tunku Abdul Rahman on the formation of Malaysia, 1963", publisher: "National Archives of Singapore" },
      { excerpt: `In a televised press conference on 9 August 1965, Prime Minister Lee Kuan Yew announced Singapore's separation from Malaysia: "For me, it is a moment of anguish. All my life, my whole adult life, I have believed in merger and the unity of these two territories." He explained that political and racial differences with the central government in Kuala Lumpur had become impossible to resolve. Singapore was now an independent and sovereign nation, responsible for its own defence, economy and survival.`, source_url: "https://www.nas.gov.sg/archivesonline/speeches/record-details/7314e57c-115d-11e3-83d5-0050568939ad", source_title: "Lee Kuan Yew's Separation press conference, 9 August 1965", publisher: "National Archives of Singapore" },
      { excerpt: `The Independence of Singapore Agreement, signed on 7 August 1965 between the Government of Malaysia and the Government of Singapore, formally provided that "Singapore shall on the 9th day of August 1965 cease to be a State of Malaysia and shall become an independent and sovereign state and nation separate from and independent of Malaysia". The agreement also dealt with the division of assets, citizenship and the continued operation of bases, and was given legal effect by acts of both parliaments.`, source_url: "https://www.nlb.gov.sg/main/article-detail?cmsuuid=2c7c0baa-bf5c-4c34-9ee6-5dffe2c79ecc", source_title: "Independence of Singapore Agreement, August 1965", publisher: "National Library Board, Singapore" },
      { excerpt: `In December 1955, the British government convened the Constitutional Conference in London to discuss self-government for Singapore. The Singapore delegation, led by Chief Minister David Marshall, demanded full internal self-government and an immediate end to British control over internal security. Britain refused to give up control of internal security, fearing communist subversion, and the talks broke down. Marshall resigned on his return. The episode showed both how far Singapore's politicians had moved towards demanding self-rule and how cautious the colonial power remained.`, source_url: "https://www.nlb.gov.sg/main/article-detail?cmsuuid=8a36dc1f-1b5a-4f7d-9c06-2c11afb0b9d0", source_title: "1956 Constitutional Talks in London", publisher: "National Library Board, Singapore" },
      { excerpt: `Indonesia's policy of Konfrontasi (Confrontation), launched by President Sukarno in 1963, opposed the formation of Malaysia as a "neo-colonial" project. Indonesian forces carried out armed incursions and bombings in Malaysian and Singaporean territory, including the MacDonald House bombing in Singapore in March 1965. Konfrontasi exposed the fragility of the new Federation, strained relations between Singapore and Kuala Lumpur over defence policy, and reinforced the case in Singapore for a separate, more pragmatic approach to regional security.`, source_url: "https://www.nas.gov.sg/archivesonline/data/pdfdoc/19650311.pdf", source_title: "Indonesian Confrontation and the MacDonald House bombing, 1965", publisher: "National Archives of Singapore" },
    ],
  },
];

/** Mutually-exclusive topic groups: if the SECTION TOPIC matches one of these
 *  groups, bundles whose triggers belong to a different group are excluded
 *  even if some LO text happens to mention them. This stops "origins of the
 *  Cold War" from picking up WWII appeasement sources just because LOs say
 *  "after the Second World War", and similar cross-topic leakage. */
const TOPIC_GROUPS: { name: string; pattern: RegExp }[] = [
  { name: "cold_war", pattern: /(cold war|truman doctrine|marshall plan|long telegram|iron curtain|berlin blockade|berlin airlift|nato|warsaw pact|containment|ideological polari|superpower rivalry|origins of the cold war)/i },
  { name: "end_cold_war", pattern: /(end of the cold war|gorbachev|perestroika|glasnost|tear down this wall|fall of the berlin wall|collapse of the (ussr|soviet union)|inf treaty)/i },
  { name: "wwii", pattern: /(world war ii|wwii|second world war|outbreak of war|appeasement|munich|league of nations|abyssinia|rhineland|anschluss|non-aggression pact|invasion of poland)/i },
  { name: "nazi", pattern: /(nazi|nazism|hitler|weimar|reichstag|enabling act|third reich|nuremberg laws|authoritarian.*germany|rise of authoritarian.*german|fascis)/i },
  { name: "stalin", pattern: /(stalin|soviet union|ussr|five-year plan|collectivisation|collectivization|gulag|great purge|show trial|authoritarian.*soviet|authoritarian.*russia|bolshevik)/i },
  { name: "decolonisation_sea", pattern: /(decolonisation|decolonization|singapore|merger|separation|lee kuan yew|malaysia|self-government|british withdrawal|konfrontasi|federation of malaya)/i },
];

function topicGroupOf(text: string): string | null {
  for (const g of TOPIC_GROUPS) if (g.pattern.test(text)) return g.name;
  return null;
}

function curatedHumanitiesSourcePool(topic: string, learningOutcomes: string[] = []): GroundedSource[] {
  // Topic-anchored matching: the SECTION TOPIC dictates the bundle. LOs are
  // only consulted when the topic alone fails to match anything (e.g. terse
  // topic strings like "Inquiry: Singapore"). Even then, an LO match is
  // rejected if it falls into a DIFFERENT topic group from the section topic
  // — this prevents "origins of the Cold War" from pulling in WWII sources
  // because LOs reference earlier context.
  const topicGroup = topicGroupOf(topic);
  const matched: GroundedSource[] = [];
  const seenUrls = new Set<string>();

  // Pass 1: TOPIC ONLY.
  for (const bundle of CURATED_HUMANITIES_BUNDLES) {
    if (!bundle.trigger.test(topic)) continue;
    for (const src of bundle.sources) {
      if (seenUrls.has(src.source_url)) continue;
      seenUrls.add(src.source_url);
      matched.push(src);
    }
  }
  if (matched.length > 0) return matched;

  // Pass 2: LO fallback — only bundles whose group matches the section topic
  // group (or whose group is not in conflict if topic group is null).
  const loBlob = learningOutcomes.join(" ");
  for (const bundle of CURATED_HUMANITIES_BUNDLES) {
    if (!bundle.trigger.test(loBlob)) continue;
    const bundleSampleText = bundle.sources.map((s) => s.source_title).join(" ");
    const bundleGroup = topicGroupOf(bundleSampleText) ?? topicGroupOf(bundle.trigger.source);
    if (topicGroup && bundleGroup && bundleGroup !== topicGroup) continue;
    for (const src of bundle.sources) {
      if (seenUrls.has(src.source_url)) continue;
      seenUrls.add(src.source_url);
      matched.push(src);
    }
  }
  return matched;
}

// ---------- Topic / Inquiry derivation for SBQ stems ----------
//
// The "topic" string stored on a section is whatever the syllabus document
// gave us (e.g. "3 · Examine the rise of authoritarian regimes (Nazi Germany)
// and evaluate the roles of key players in the establishment of authoritarian
// rule."). For SBQ stems we need a CONCISE NOUN PHRASE — never a directive
// command-word sentence pasted verbatim. These helpers do that cleaning.

const LO_COMMAND_WORDS_RE = /^(examine|evaluate|analyse|analyze|assess|discuss|explain|describe|compare|consider|investigate|justify|argue|outline)\b\s*/i;

function stripCodePrefix(s: string): string {
  // "3 · Examine …" / "1.2 · Foo" / "1.2.3 — Bar"
  return s.replace(/^\s*[\w.]+\s*[·•—–-]\s*/, "").trim();
}

/** Reduce a raw syllabus topic / LO directive to a noun-phrase suitable for
 *  insertion inside an analytical question stem ("about {T}", "in {T}", etc). */
function deriveTopicNoun(rawTopic: string, learningOutcomes: string[] = []): string {
  let s = stripCodePrefix(rawTopic).replace(/\*+$/, "").trim();

  // If the title is a directive ("Examine the rise of …"), drop the verb and
  // any "and evaluate / and explain …" tail so we keep only the subject matter.
  if (LO_COMMAND_WORDS_RE.test(s)) {
    // Prefer a parenthetical scope if present: "… (Nazi Germany) …"
    const paren = s.match(/\(([^)]{2,80})\)/);
    s = s.replace(LO_COMMAND_WORDS_RE, "");
    // Drop any trailing "and <verb> …" clause.
    s = s.replace(/\s+and\s+(evaluate|explain|describe|analyse|analyze|assess|discuss|consider|investigate|justify|argue|outline)\b.*$/i, "");
    // Drop redundant tails such as "… in the establishment of authoritarian rule".
    s = s.replace(/\s+in the (establishment|development|emergence|making) of [^.]*$/i, "");
    s = s.replace(/[.!?]+\s*$/, "").trim();
    if (paren) s = paren[1].trim();
  }

  // Lower-case the very first word unless it's a proper noun (kept if word starts
  // with an uppercase letter followed by a lowercase letter AND isn't a verb-like
  // gerund). Cheap heuristic: keep capitalisation as-is if it contains a known
  // proper-noun marker (place/era).
  const looksProper = /\b(Nazi|Soviet|USSR|USA|Britain|British|German|Germany|Singapore|Malaysia|Cold War|World War|League of Nations|Berlin|European|American|Russian|China|Chinese|Japan|Japanese|Vietnam)\b/.test(s);
  if (!looksProper && s.length > 0 && /^[A-Z][a-z]/.test(s)) {
    s = s.charAt(0).toLowerCase() + s.slice(1);
  }

  // Final guard: if cleaning failed (still starts with a directive verb or
  // starts with the topic code), try to pull the most history-flavoured noun
  // phrase from the LOs.
  if (!s || LO_COMMAND_WORDS_RE.test(s)) {
    const loBlob = learningOutcomes.join(" ");
    const m = loBlob.match(/\b(rise of [\w\s]+|fall of [\w\s]+|origins of [\w\s]+|end of the cold war|cold war|world war [iI]+|decolonisation|merger|separation|appeasement)\b/i);
    if (m) s = m[1];
  }

  // Trim length: question stems read poorly with 15+ word noun phrases.
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 12) s = words.slice(0, 12).join(" ");

  return s || "this issue";
}

/** Build the opening Key Inquiry Question for an SBQ section. The phrasing is
 *  chosen deterministically based on which SBQ skills appear in the section so
 *  the inquiry meshes with the assertion / hypothesis sub-part below it. */
function buildInquiryQuestion(topicNoun: string, skills: (SbqSkillDef | null)[]): string {
  const has = (id: string) => skills.some((s) => s?.id === id);
  if (has("assertion")) {
    return `How far was ${topicNoun} shaped by the actions of the major actors involved?`;
  }
  if (has("comparison")) {
    return `How far do contemporary accounts agree on the nature of ${topicNoun}?`;
  }
  if (has("utility") || has("reliability")) {
    return `How useful are these sources for understanding ${topicNoun}?`;
  }
  if (has("purpose")) {
    return `Why did contemporaries portray ${topicNoun} in the ways that they did?`;
  }
  return `What can these sources tell us about ${topicNoun}?`;
}

function buildDeterministicSbqQuestions(section: Section, sources: GroundedSource[], skills: (SbqSkillDef | null)[]): any[] {
  const rawTopic = section.topic_pool[0]?.topic ?? "";
  const sectionLOs = section.topic_pool[0]?.learning_outcomes
    ?? section.learning_outcomes
    ?? [];
  // Concise noun phrase for {T} — never paste the LO directive into the stem.
  const topicNoun = deriveTopicNoun(rawTopic, sectionLOs);
  // Topic field stored on the row (used for tagging only, not the stem).
  const topicTag = stripCodePrefix(rawTopic).replace(/\*+$/, "").trim() || topicNoun;
  const inquiry = buildInquiryQuestion(topicNoun, skills);

  const perQMarks = Math.floor(section.marks / Math.max(1, section.num_questions));
  const remainder = section.marks - perQMarks * section.num_questions;
  const labels = sources.map((_, i) => String.fromCharCode(65 + i));
  const allLabels = labels.join(", ");

  return Array.from({ length: section.num_questions }, (_, i) => {
    const skill = skills[i] ?? null;
    const skillId = skill?.id ?? "inference";
    const part = String.fromCharCode(97 + i);
    const marks = skill?.locked ? skill.default : perQMarks + (i < remainder ? 1 : 0);
    const single = labels[i % Math.max(1, labels.length)] ?? "A";
    const second = labels[(i + 1) % Math.max(1, labels.length)] ?? "B";
    const intro = i === 0 ? `${inquiry}\n\n` : "";

    const templates = SBQ_STEM_TEMPLATES[skillId] ?? SBQ_STEM_TEMPLATES.inference;
    // Rotate template choice by question index so the paper varies its phrasings.
    const tpl = templates[i % templates.length];
    const prompt = tpl
      .replace(/\{S1\}/g, single)
      .replace(/\{S2\}/g, second)
      .replace(/\{ALL\}/g, allLabels)
      .replace(/\{T\}/g, topicNoun)
      .replace(/\{P\}/g, part);

    // Pull a short snippet from the bound source(s) so the deterministic
    // exemplar can quote real text. Trim to ~120 chars and end on a word.
    const snippet = (text: string | undefined, max = 120): string => {
      const t = (text ?? "").replace(/\s+/g, " ").trim();
      if (!t) return "";
      if (t.length <= max) return t;
      const cut = t.slice(0, max);
      const lastSpace = cut.lastIndexOf(" ");
      return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + "…";
    };
    const singleIdx = i % Math.max(1, sources.length);
    const secondIdx = (i + 1) % Math.max(1, sources.length);
    const q1 = snippet(sources[singleIdx]?.excerpt);
    const q2 = snippet(sources[secondIdx]?.excerpt);
    const allQuotes = sources.map((s, idx) => `Source ${labels[idx]}: "${snippet(s.excerpt, 80)}"`).join("; ");

    let answer: string;
    if (skillId === "comparison") {
      answer = `Sources ${single} and ${second} share a broad message about ${topicNoun}: both frame it as a development with significant consequences (Source ${single}: "${q1}"; Source ${second}: "${q2}"). However, they differ in tone and emphasis — Source ${single} reads as more measured and observational, while Source ${second} adopts a more pointed, evaluative register, reflecting their different authors and intended audiences. Looking at provenance, Source ${single}'s framing reflects the perspective of its publisher and date, whereas Source ${second}'s framing reflects a different vantage point. Overall, the two sources agree on the broad significance of ${topicNoun} but disagree on how to interpret it; the difference in tone and provenance is the more substantial divergence, so I would judge them only partially similar.`;
    } else if (skillId === "assertion") {
      answer = `On balance, the sources offer mixed support for the assertion. SUPPORT: several sources back the claim — for example, ${allQuotes} — together suggesting that ${topicNoun} was indeed shaped in the way the assertion proposes. CHALLENGE: other sources qualify or contradict the assertion, pointing to alternative drivers and counter-examples. SOURCE QUALITY: the supporting sources include contemporary documents whose provenance lends weight, but they also reflect the partial perspective of their authors; the challenging sources draw on different vantage points and so cannot simply be dismissed. Weighing the set as a whole, the assertion is partially supported: the strongest contemporary evidence aligns with it, but the qualifications raised by the more critical sources show that the picture is more nuanced than the assertion implies.`;
    } else if (skillId === "utility") {
      answer = `Source ${single} is moderately useful as evidence about ${topicNoun}. CONTENT: it provides specific details — "${q1}" — that illuminate how the issue was perceived at the time. PROVENANCE: as a contemporary publication aimed at a specific audience, it gives us direct access to attitudes of that period, which raises its utility. LIMITATIONS: it cannot show the views of those outside that audience, omits the wider economic and political context, and reflects the editorial agenda of its publisher. Overall, Source ${single} is useful for understanding contemporary perspectives on ${topicNoun}, but it must be read alongside other sources to build a balanced picture.`;
    } else if (skillId === "reliability") {
      answer = `Source ${single} is partially reliable as evidence about ${topicNoun}. CROSS-REFERENCE: its claim that "${q1}" is broadly consistent with what we know from contextual evidence about ${topicNoun}, which strengthens its trustworthiness on that point. PROVENANCE: published by a known outlet at the time of the events, it has the immediacy of contemporary reporting, but its readership and editorial line shape what it chose to include. BIAS / MOTIVE: the language is not neutral — the framing serves a particular agenda, and certain perspectives are conspicuously absent. Overall, Source ${single} can be trusted on the broad facts of ${topicNoun} but its interpretation should be treated with caution; cross-checking against sources with a different vantage point is essential.`;
    } else if (skillId === "purpose") {
      answer = `The purpose of Source ${single} is to shape contemporary opinion about ${topicNoun} — most likely to persuade its readership to adopt a particular view. PROVENANCE: published by its named author for a specific contemporary audience at a critical moment, it was produced precisely when public attitudes were being formed. CONTENT: the loaded phrasing — "${q1}" — and what the source chooses to emphasise (or omit) point to a clear persuasive intent rather than a neutral record. Drawing on contextual knowledge of the period, it is reasonable to conclude that Source ${single} was produced to mobilise sympathy for one side of the debate over ${topicNoun}.`;
    } else if (skillId === "surprise") {
      answer = `I am partly surprised by Source ${single}. SURPRISING: the claim that "${q1}" is unexpected because contextual knowledge suggests that contemporary attitudes were generally more cautious about ${topicNoun}. NOT SURPRISING: at the same time, given the source's provenance — its author, audience and date — the framing is consistent with what that publication would be expected to argue, and other contemporary evidence shows similar views were in circulation. Overall I am more surprised by the strength of the language than by the position itself; the position fits the period, but the framing goes further than I would have predicted.`;
    } else {
      answer = `Source ${single} suggests two things about ${topicNoun}. First, it implies that contemporary opinion was strongly engaged with the issue: the source states that "${q1}", which suggests not just description but evaluation by the author. Secondly, it implies that there was a particular perspective being promoted — the language used reveals attitudes and assumptions, not just facts, indicating that the author was inviting readers to share a specific view. Overall, Source ${single} reveals that ${topicNoun} was a contested issue at the time, and that the source itself is a deliberate intervention in that contest rather than a neutral record.`;
    }

    const scheme = skill?.markScheme ?? SBQ_SKILLS.inference.markScheme;

    return {
      question_type: "source_based",
      topic: topicTag,
      bloom_level: section.bloom ?? "Analyse",
      difficulty: "medium",
      marks,
      stem: intro + prompt,
      options: null,
      answer,
      mark_scheme: scheme,
    };
  });
}

/** Enforce a HARD CAP: the sum of `marks` across the questions in a section
 *  must equal `targetMarks`. Honours `lockedIndices` for SBQ skills locked at a
 *  fixed mark value (e.g. assertion at 8). All questions floored at 1 mark. */
function normalizeSectionMarks(
  questions: Array<{ marks?: number | null }>,
  targetMarks: number,
  lockedIndices: Set<number> = new Set(),
): void {
  const n = questions.length;
  if (n === 0 || targetMarks <= 0) return;

  let lockedSum = 0;
  for (const i of lockedIndices) {
    if (i >= 0 && i < n) {
      const m = Math.max(1, Math.floor(questions[i].marks ?? 1));
      questions[i].marks = m;
      lockedSum += m;
    }
  }

  if (lockedSum > targetMarks) {
    console.warn(`[generate] locked marks (${lockedSum}) exceed section budget (${targetMarks}); skipping mark normalization`);
    return;
  }

  const flexibleIdx: number[] = [];
  for (let i = 0; i < n; i++) if (!lockedIndices.has(i)) flexibleIdx.push(i);
  const flexCount = flexibleIdx.length;
  const flexBudget = targetMarks - lockedSum;
  if (flexCount === 0) return;

  if (flexBudget < flexCount) {
    console.warn(`[generate] section budget too small for ${n} questions (locked=${lockedSum}, target=${targetMarks}); clamping each non-locked question to 1 mark`);
    for (const i of flexibleIdx) questions[i].marks = 1;
    return;
  }

  const rawFlex = flexibleIdx.map((i) => Math.max(1, Math.floor(questions[i].marks ?? 1)));
  const rawSum = rawFlex.reduce((a, b) => a + b, 0);
  const scaled = rawFlex.map((m) => Math.max(1, Math.floor((m * flexBudget) / Math.max(1, rawSum))));
  let scaledSum = scaled.reduce((a, b) => a + b, 0);

  if (scaledSum < flexBudget) {
    const order = [...scaled.keys()].sort((a, b) => scaled[a] - scaled[b]);
    let k = 0;
    while (scaledSum < flexBudget) {
      scaled[order[k % order.length]] += 1;
      scaledSum += 1;
      k++;
    }
  } else if (scaledSum > flexBudget) {
    const order = [...scaled.keys()].sort((a, b) => scaled[b] - scaled[a]);
    let k = 0;
    const safety = flexCount * (flexBudget + 5);
    while (scaledSum > flexBudget && k < safety) {
      const idx = order[k % order.length];
      if (scaled[idx] > 1) {
        scaled[idx] -= 1;
        scaledSum -= 1;
      }
      k++;
    }
  }

  for (let j = 0; j < flexibleIdx.length; j++) {
    questions[flexibleIdx[j]].marks = scaled[j];
  }
}

type LegacyBlueprintRow = {
  topic: string;
  bloom?: string;
  marks: number;
  topic_code?: string | null;
  section?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  mcq: "multiple-choice (4 options, one correct)",
  short_answer: "short-answer (1-2 sentence response)",
  structured: "structured (multi-part, e.g. (a), (b), (c))",
  long: "long-answer / essay",
  comprehension: "comprehension passage with sub-questions",
  practical: "practical / applied scenario",
  source_based: "source-based with stimulus and analysis",
};

// ---------- Blueprint normalisation ----------

function toSections(blueprint: unknown, defaultType: string, fallbackQuestionTypes: string[]): Section[] {
  // New shape: { sections: [...] }
  if (
    blueprint &&
    typeof blueprint === "object" &&
    !Array.isArray(blueprint) &&
    Array.isArray((blueprint as { sections?: unknown }).sections)
  ) {
    return ((blueprint as { sections: Section[] }).sections).map((s, i) => ({
      ...s,
      letter: s.letter ?? String.fromCharCode(65 + i),
      num_questions: Math.max(1, s.num_questions || 1),
      marks: Math.max(1, s.marks || 1),
      topic_pool: Array.isArray(s.topic_pool) ? s.topic_pool : [],
    }));
  }
  // Legacy flat shape: collapse into a single virtual section.
  if (Array.isArray(blueprint)) {
    const rows = blueprint as LegacyBlueprintRow[];
    if (rows.length === 0) return [];
    const totalMarks = rows.reduce((acc, r) => acc + (r.marks || 0), 0);
    return [{
      letter: "A",
      question_type: fallbackQuestionTypes[0] ?? defaultType,
      marks: totalMarks,
      num_questions: rows.length,
      bloom: rows[0]?.bloom ?? "Apply",
      topic_pool: rows.map((r) => ({
        topic: r.topic,
        topic_code: r.topic_code ?? null,
        learning_outcomes: r.learning_outcomes,
        ao_codes: r.ao_codes,
        outcome_categories: r.outcome_categories,
      })),
      instructions: "Answer all questions in this section.",
    }];
  }
  return [];
}

// ---------- Prompts ----------

function buildSystemPrompt(subject: string, level: string, paperCode?: string | null) {
  const alignLine = paperCode
    ? `All questions must align to MOE syllabus paper ${paperCode}. Reference the topic code (e.g. §1.2) when relevant in mark schemes.`
    : "";
  return `You are an expert assessment writer for the Singapore Ministry of Education (MOE) syllabus.
You write clear, fair, age-appropriate questions for ${level} ${subject}.
Always use British English spelling and SI units. Use Singapore-relevant contexts (HDB, MRT, hawker centres, neighbourhood schools, local names like Wei Ling, Aravind, Mei Ling, Hadi) where natural.
Match MOE phrasing conventions and difficulty norms for ${level}.
${alignLine}
Each question must include a clear stem, a precise answer, and a marking scheme that breaks down marks where appropriate.
Use Bloom's taxonomy levels rigorously.
When a "GROUNDED SOURCE" block is provided for a question, you MUST:
  - Place the verbatim source text inside the question stem under a "Source A" heading (or "Passage" for English comprehension).
  - NOT paraphrase, summarise, translate, or alter the source text in any way.
  - Add a citation line directly under the source: \`Source: {publisher} — {url}\`.
  - Write your sub-questions to refer to the passage / Source A by name (e.g. "According to Source A, …").
  - NEVER fabricate sources, attributions, or URLs of your own.`;
}

function buildSectionUserPrompt(opts: {
  title: string; subject: string; level: string; assessmentType: string;
  durationMinutes: number; totalMarks: number;
  section: Section; sectionIndex: number; totalSections: number;
  syllabusCode?: string | null; paperCode?: string | null;
  groundedSources: (GroundedSource | null)[][]; // [questionIdx][sourceIdx]
  sharedSourcePool?: GroundedSource[]; // For humanities SBQ: ONE shared pool A–E
  sharedImageSources?: GroundedImageSource[]; // Optional pictorial sources appended to the pool
  subjectKind?: "humanities" | "english" | null;
  instructions?: string;
  /** Per-question difficulty targets for THIS chunk (length === section.num_questions). */
  difficultyTargets?: ("easy" | "medium" | "hard")[];
}) {
  const { section } = opts;
  const typeLabel = QUESTION_TYPE_LABELS[section.question_type] ?? section.question_type;
  const isHumanitiesSBQ =
    opts.subjectKind === "humanities" && section.question_type === "source_based";
  const isHistoryEssay =
    opts.subjectKind === "humanities" && section.question_type === "long";

  const topicLines = section.topic_pool.map((t, i) => {
    const code = t.topic_code ? ` [${t.topic_code}]` : "";
    const los = t.learning_outcomes && t.learning_outcomes.length > 0
      ? `\n     Learning outcomes: ${t.learning_outcomes.slice(0, 3).map((lo) => `• ${lo}`).join(" ")}`
      : "";
    const aos = t.ao_codes && t.ao_codes.length > 0
      ? `\n     Assessment Objectives: ${t.ao_codes.join(", ")}`
      : "";
    return `  ${i + 1}. ${t.topic}${code}${los}${aos}`;
  }).join("\n");

  const humanitiesSourceGuidance = opts.subjectKind === "humanities"
    ? `\nSOURCE NATURE: All grounded sources for this section are PRIMARY SOURCES (archives, government records, contemporary newspaper reportage, speeches, treaties, museum-held documents) or SECONDARY SOURCES presenting a HISTORIAN'S PERSPECTIVE (scholarly analysis, edited reference works). Treat each source as analysable evidence, not as a textbook summary. Sub-questions MUST require students to interrogate the source — its content, provenance, tone, purpose, reliability, or utility — not merely paraphrase it.\n`
    : "";

  // For HUMANITIES SBQ: render ONE shared Sources A–E block at the section level,
  // anchored on a single Key Inquiry Question. All sub-questions reference it.
  // For everything else: per-question source blocks (existing behaviour).
  let sourceBlocks = "";
  let sbqSectionPreamble = "";
  if (isHumanitiesSBQ && opts.sharedSourcePool && opts.sharedSourcePool.length > 0) {
    const pool = opts.sharedSourcePool;
    const sectionTopic = section.topic_pool[0]?.topic ?? "the topic";
    const labels = pool.map((_, i) => String.fromCharCode(65 + i));
    const images = opts.sharedImageSources ?? [];
    const imageLabels = images.map((_, i) => String.fromCharCode(65 + pool.length + i));
    const allLabels = [...labels, ...imageLabels];
    const labelList = allLabels.join(", ");
    const blocks = pool.map((src, i) => {
      const label = labels[i];
      const prov = src.provenance ?? `From ${src.publisher}.`;
      return `  [Source ${label}]
  Provenance: ${prov}
  Link: ${src.source_url}
  Excerpt (use VERBATIM, do not modify):
  ---
  ${src.excerpt}
  ---
  Citation: Source: ${src.publisher} — ${src.source_url}`;
    }).join("\n\n");
    const imageBlocks = images.map((img, i) => {
      const label = imageLabels[i];
      const prov = img.provenance ?? `From ${img.publisher}.`;
      return `  [Source ${label}] PICTORIAL PRIMARY SOURCE (cartoon / poster / photograph / graph / chart / map / table):
  Provenance: ${prov}
  Link: ${img.source_url}
  ---
  Caption: ${img.caption}
  Image URL: ${img.image_url}
  ---
  Citation: Source: ${img.publisher} — ${img.source_url}
  NOTE: Source ${label} is an IMAGE, not text. The student will SEE the picture. Do NOT quote text from it. When you write a sub-part anchored on Source ${label}, ask students to INTERPRET the image — for cartoons/posters: message, perspective, audience, intent ("Study Source ${label}. What is the message of the cartoonist?"); for photographs: what it shows and what it implies; for graphs/charts/tables: trends, comparisons, scale, what the data suggests ("Study Source ${label}. What does the chart suggest about [issue]?"); for maps: territory, change, projection, what is emphasised. Reference the caption only as context.`;
    }).join("\n\n");
    const imageBlock = imageBlocks ? `\n\n${imageBlocks}` : "";
    const concatenatedExcerpt = pool
      .map((s, i) => `Source ${labels[i]}: ${s.excerpt}`)
      .join("\\n\\n");
    sbqSectionPreamble = `

THIS IS A SOURCE-BASED QUESTION (SBQ) SECTION — SEAB / MOE FORMAT:

STRUCTURE — READ CAREFULLY:
  - The ENTIRE section is ONE single source-based question, structured around ONE KEY LINE OF INQUIRY about "${sectionTopic}".
  - That single question has up to ${section.num_questions} parts: (a), (b), (c), (d), (e) — all investigating the SAME line of inquiry.
  - You MUST open the FIRST part's stem with a clear KEY INQUIRY QUESTION (a debatable, analytical line of inquiry — e.g. "How far was X responsible for Y?", "To what extent did X cause Y?", "Why did X happen?"), then a blank line, then the (a) sub-question.
  - Sub-parts (b), (c), (d), (e) do NOT repeat the inquiry question; they are simply further parts of the same investigation.

ABSOLUTE BAN ON CONTENT-RECALL STEMS (CRITICAL — non-negotiable):
  - Every SBQ sub-part MUST require, at minimum, an INFERENCE — a reading of the source that goes BEYOND what is literally stated.
  - The following stem patterns are FORBIDDEN because they only test surface description, not inference:
      ✗ "What does Source A describe / show / depict / say about …?"
      ✗ "What characteristics / features / details does Source A tell you about …?"
      ✗ "List / Identify / State / Name what Source A says about …" (any version that asks the student to lift content)
      ✗ "According to Source A, what is …?" (pure recall of stated content)
  - The MINIMUM acceptable stem starts with one of: "What can you infer from Source A about …?", "What is the message of Source A?", "What does Source A SUGGEST / IMPLY / REVEAL about …?" (note: "tell you about" is acceptable ONLY when paired with a topic that demands inference — e.g. "what does Source A tell you about contemporary attitudes / perspectives / motivations / unstated assumptions about …", NEVER "what does Source A tell you about the events / facts / characteristics of …").
  - Higher-skill stems (Comparison, Reliability, Utility, Purpose, Surprise, Assertion) are also acceptable; the inference floor only forbids questions BELOW inference.

SOURCE-BINDING RULES (CRITICAL):
  - Each sub-part is built on ONE specific source from Sources ${labelList} below — NOT a free choice.
  - The ONLY exceptions:
      • COMPARISON sub-parts may reference EXACTLY TWO sources (e.g. "Compare Sources A and B").
      • ASSERTION (hypothesis) sub-parts must use ALL ${allLabels.length} sources (Sources ${labelList}).
  - Every sub-part's stem MUST begin with an explicit instruction naming the source(s) it uses, e.g. "Study Source A.", "Study Sources A and B.", "Study Sources ${labelList}."
  - Across the section, DIFFERENT sub-parts should be anchored on DIFFERENT sources where possible (e.g. (a) → Source A, (b) → Source B, (c) → Source C, comparison → A & B, assertion → all). Do NOT bind two different sub-parts to the same single source.${imageLabels.length > 0 ? `\n  - At least ONE sub-part SHOULD be anchored on a pictorial source (Sources ${imageLabels.join(", ")}). If you anchor a sub-part on a pictorial source, the stem MUST ask the student to INTERPRET the image — message, perspective, trend, data, scale, territory — NEVER to quote text from it.` : ""}
  - DO NOT invent new sources. DO NOT paraphrase or modify the source text.
  - For EVERY part in this section, set source_excerpt to the FULL concatenated pool below (so the editor shows all sources to the student). Set source_url to Source A's URL.

SHARED SOURCES FOR THIS SECTION (Sources ${labelList}):
${blocks}${imageBlock}

  source_excerpt value to use for EVERY part in this section:
  "${concatenatedExcerpt}"
  source_url value to use for EVERY part in this section: ${pool[0].source_url}`;
  } else {
    sourceBlocks = opts.groundedSources.map((slot, qi) => {
      const valid = slot.filter((s): s is GroundedSource => !!s);
      if (valid.length === 0) return "";
      const blocks = valid.map((src, si) => {
        const label = String.fromCharCode(65 + si);
        return `  [Question ${qi + 1} · Source ${label}] (use VERBATIM, do not modify):
  ---
  ${src.excerpt}
  ---
  Citation: Source: ${src.publisher} — ${src.source_url}`;
      }).join("\n\n");
      return `\n${blocks}\n  Set source_excerpt for question ${qi + 1} to the EXACT text of Source A above (or, if multiple sources, concatenate them as "Source A: …\\n\\nSource B: …"). Set source_url to the URL of Source A.`;
    }).join("\n");
  }

  const grounding = opts.paperCode
    ? `Aligned to MOE syllabus ${opts.syllabusCode ?? ""} paper ${opts.paperCode}.\n`
    : "";

  const perQMarks = Math.floor(section.marks / Math.max(1, section.num_questions));
  const remainder = section.marks - perQMarks * section.num_questions;
  const marksGuide = remainder > 0
    ? `Distribute ${section.marks} marks across ${section.num_questions} questions. Most questions get ${perQMarks} marks; ${remainder} question(s) get 1 extra mark.`
    : `Each of the ${section.num_questions} question(s) is worth ${perQMarks} marks (total ${section.marks}).`;
  const marksHardCap = `HARD CONSTRAINT: the SUM of "marks" across the ${section.num_questions} question(s) MUST equal EXACTLY ${section.marks}. Do NOT exceed ${section.marks} under any circumstances. If the natural mark for a part would push the section past ${section.marks}, lower it.`;

  const sectionLabel = section.name ? `Section ${section.letter} — ${section.name}` : `Section ${section.letter}`;

  const effectiveSkillIds = resolveEffectiveSkills(section);
  const effectiveSkills = effectiveSkillIds.map((id) => SBQ_SKILLS[id]).filter(Boolean);
  const perQuestionSkills = assignSkillsToQuestions(effectiveSkills, section.num_questions);

  let skillBlock = "";
  if (effectiveSkills.length > 0) {
    const poolLabels = (opts.sharedSourcePool ?? []).map((_, i) => String.fromCharCode(65 + i));
    const poolLabelList = poolLabels.join(", ") || "A";
    const skillSummaries = effectiveSkills.map((s) => `- ${s.label}: ${s.promptHeader}\n  Mark scheme: ${s.markScheme}`).join("\n\n");
    const assignments = perQuestionSkills.map((s, i) => {
      if (!s) return `  - Question ${i + 1}: generic SBQ (no specific skill assigned)`;
      const lockedNote = s.locked
        ? ` — MUST be exactly ${s.default} marks and use ALL ${poolLabels.length || "available"} sources (${poolLabelList})`
        : ` — must be worth one of: ${s.marks.join(", ")} marks`;
      let srcNote: string;
      if (isHumanitiesSBQ) {
        const partLetter = String.fromCharCode(97 + i); // a, b, c...
        const boundSource = String.fromCharCode(65 + (i % Math.max(1, poolLabels.length))); // A, B, C...
        if (s.id === "assertion") srcNote = ` — uses ALL Sources ${poolLabelList} from the shared pool. Stem MUST start with "Study Sources ${poolLabelList}."`;
        else if (s.minSources >= 2) {
          const second = String.fromCharCode(65 + ((i + 1) % Math.max(1, poolLabels.length)));
          srcNote = ` — uses EXACTLY TWO sources: Sources ${boundSource} and ${second}. Stem MUST start with "Study Sources ${boundSource} and ${second}."`;
        } else {
          srcNote = ` — uses ONLY Source ${boundSource} (one source). Stem MUST start with "Study Source ${boundSource}." Part (${partLetter}).`;
        }
      } else {
        srcNote = s.minSources >= 2 ? ` (uses at least ${s.minSources} sources labelled Source A, B${s.minSources >= 3 ? ", C" : ""}…)` : ` (uses Source A)`;
      }
      return `  - Question ${i + 1} (part ${String.fromCharCode(97 + i)}): ${s.label}${lockedNote}${srcNote}`;
    }).join("\n");

    // Per-skill L4 sample-answer guidance — one block per UNIQUE skill used
    // in this section, so the model knows what an L4 candidate response looks
    // like for each assigned skill.
    const usedSkillIds = Array.from(new Set(perQuestionSkills.filter((s): s is SbqSkillDef => !!s).map((s) => s.id)));
    const sampleAnswerBlock = usedSkillIds
      .map((id) => SBQ_SAMPLE_ANSWER_GUIDANCE[id])
      .filter(Boolean)
      .join("\n\n");

    skillBlock = `

SBQ SKILL ASSIGNMENTS (apply each skill's format and mark scheme to the assigned part):
${skillSummaries}

PER-PART SKILL & SOURCE-BINDING MAPPING (you MUST follow this exact mapping — DO NOT swap sources between parts):
${assignments}

IMPORTANT: For Assertion parts, the hypothesis MUST be testable against ALL sources (each should plausibly support OR challenge it). For single-source parts, the bound source is FIXED above — name it explicitly in the stem. Do NOT mix skill formats across parts. Do NOT bind two different single-source parts to the same source.

SAMPLE ANSWER REQUIREMENTS (CRITICAL — the answer field for EVERY SBQ part MUST be a fully-written L4 candidate exemplar, NOT a meta-description):
  - Write the answer as if YOU were the candidate sitting the paper, in continuous prose paragraphs.
  - The answer MUST hit the L4 descriptors of the part's assigned LORMS skill — explicitly performing the L4 moves listed below.
  - The answer MUST quote SHORT verbatim phrases (in quotation marks) from the actual provided source(s) the part is anchored on — pull them from the SHARED SOURCES block above. For pictorial sources, refer to specific visible elements / data / symbols instead of quoting text.
  - FORBIDDEN openings for the answer field: "A strong answer would…", "A model response would…", "The candidate should…", "Students should…". Write the answer DIRECTLY (e.g. "Source A suggests that…", "I am more surprised than not, because…").

Per-skill L4 expectations for the answer field:
${sampleAnswerBlock}`;
  }

  let difficultyBlock = "";
  if (opts.difficultyTargets && opts.difficultyTargets.length === section.num_questions) {
    const lines = opts.difficultyTargets
      .map((d, i) => `  - Question ${i + 1}: ${d.toUpperCase()}`)
      .join("\n");
    const rubric = buildDifficultyRubricBlock(opts.difficultyTargets);
    difficultyBlock = `
${rubric}

DIFFICULTY DISTRIBUTION (REQUIRED — set the difficulty field on each question to EXACTLY the target below, AND calibrate the stem to match the rubric for that level):
${lines}

Per-slot calibration is observable: the EASY items must be visibly easier than the HARD items in number of reasoning steps, novelty of context, distractor closeness (for MCQ), constraint count, and required selection of principle. Do NOT generate items of similar demand and merely relabel them.`;
  }

  // Resolve effective objective pool for this section: prefer section-level
  // overrides, fall back to whatever the topic pool already carries.
  const sectionAOs = (section.ao_codes && section.ao_codes.length > 0)
    ? section.ao_codes
    : Array.from(new Set(section.topic_pool.flatMap((t) => t.ao_codes ?? [])));
  const sectionKOs = (section.knowledge_outcomes && section.knowledge_outcomes.length > 0)
    ? section.knowledge_outcomes
    : Array.from(new Set(section.topic_pool.flatMap((t) => t.outcome_categories ?? [])));
  const sectionLOs = (section.learning_outcomes && section.learning_outcomes.length > 0)
    ? section.learning_outcomes
    : Array.from(new Set(section.topic_pool.flatMap((t) => t.learning_outcomes ?? [])));

  const objectivesBlock = (sectionAOs.length + sectionKOs.length + sectionLOs.length) > 0 ? `

OBJECTIVES TO COVER (each generated question MUST list the AO codes, KO categories, and LO statements it actually addresses — set ao_codes, knowledge_outcomes and learning_outcomes accordingly):
${sectionAOs.length > 0 ? `  - Assessment Objectives pool: ${sectionAOs.join(", ")}\n` : ""}${sectionKOs.length > 0 ? `  - Knowledge Outcome categories pool: ${sectionKOs.join(", ")}\n` : ""}${sectionLOs.length > 0 ? `  - Learning Outcomes pool (verbatim statements):\n${sectionLOs.slice(0, 20).map((lo) => `      • ${lo}`).join("\n")}\n` : ""}
Across the ${section.num_questions} questions in this section, COLLECTIVELY cover every item in the pools above.

TAG INCLUSIVELY (CRITICAL — under-tagging creates false "uncovered" warnings):
  - For EACH question, tag EVERY LO from the pool that the stem (and any sub-parts and the model answer) genuinely demonstrates — not just the single most central one. Most multi-part structured questions and source-based questions exercise 2–4 LOs at once.
  - Tag EVERY KO category that the question demands. A question that asks the student to explain AND apply normally tags both "Understanding" and "Application". A compare/evaluate question normally tags "Skills" + "Understanding".
  - Tag EVERY AO the stem demands. A 6-mark structured item that asks the student to describe (AO1) AND explain (AO2) tags both AO1 and AO2.
  - LO statements MUST be copied verbatim from the pool above (so coverage matching works).
  - Do NOT, however, blanket-tag every LO/KO/AO on every question — only those the stem ACTUALLY exercises.

WORKED EXAMPLE (illustrative; adapt the principle, not the wording):
  Stem: "Study Source A. Compare the views of the two newspapers on the 1969 racial riots. Explain your answer using details from both sources."
  Tags: ao_codes = ["AO3"]; knowledge_outcomes = ["Understanding", "Skills"]; learning_outcomes = [the LO about analysing primary sources, the LO about communal relations / the 1969 riots] — both LOs, because the stem demands both.

LO/KO USAGE RULE (CRITICAL — applies to every question stem):
  - Learning Outcomes and Knowledge Outcomes describe what the student must DEMONSTRATE through their answer. They are NOT question stems and MUST NOT be copied into a stem verbatim, even with light paraphrasing.
  - Each question stem must be a fresh ANALYTICAL inquiry that REQUIRES the student to use the source(s) and contextual knowledge to reason toward an answer that EVIDENCES one or more LOs.
  - Question stems MUST start with an SEAB AO3 command word — e.g. "Study Source …", "Compare …", "How far …", "Why …", "To what extent …", "How useful …", "How reliable …", "What can you infer …", "What is the message of …", "Why was Source … produced …", "Are you surprised by …".
  - Question stems MUST NOT start with directive verbs taken from the LO statements: NO "Examine …", "Evaluate …", "Analyse …", "Assess …", "Discuss …", "Explain …", "Describe …" as the opening of an SBQ sub-part. Those verbs belong in the rubric the STUDENT performs, not the question.
  - The TOPIC field on a question is a short noun-phrase tag (e.g. "Nazi rise to power", "Berlin Blockade") — never a full sentence directive copied from the syllabus title.` : "";

  const historyEssayBlock = isHistoryEssay ? `

HISTORY SECTION B ESSAY FORMAT (mandatory for every question in this section):

QUESTION STEM REQUIREMENTS:
  - Each stem MUST be a TWO-FACTOR analytical question using one of these SEAB command-word openings: "How far …", "To what extent …", "Which was more important in …, X or Y?", "Was X the most important reason for …?".
  - The stem MUST explicitly NAME the two factors the student will weigh (e.g. "How far was Hitler's leadership, rather than the weakness of the Weimar Republic, responsible for the Nazi rise to power?"). Do NOT leave the second factor implied.
  - The stem MUST require both DESCRIPTION + EXPLANATION + EVALUATION to access full marks — pure recall stems are not acceptable.

MARK SCHEME (write into the mark_scheme field):
${HISTORY_ESSAY_MARK_SCHEME}

ANSWER (write into the answer field):
${HISTORY_ESSAY_ANSWER_TEMPLATE}

HARD REQUIREMENTS:
  - The mark_scheme field MUST contain the four L1–L4 lines VERBATIM (exact wording, exact mark ranges) followed by 1–2 indicative-content bullets per level tailored to the specific question.
  - The answer field MUST be a fully written model essay (~400–600 words) following the 5-part structure (Introduction → Factor 1 PEEL → Factor 2 PEEL → Evaluation → Conclusion), with at least 4 specific historical references (dates, named individuals, named events, organisations, statistics, treaty/policy names) per factor paragraph. The model essay must demonstrate L4 historical analysis and evaluation.
  - Do NOT shorten the answer to a bullet outline. Write full prose paragraphs.
` : "";

  return `${grounding}You are drafting ${sectionLabel} of "${opts.title}" (${opts.level} ${opts.subject}, ${opts.assessmentType}, ${opts.durationMinutes} min, ${opts.totalMarks} total marks across ${opts.totalSections} sections).

THIS SECTION:
  - Question type for ALL questions in this section: ${typeLabel} — DO NOT mix in other types.
  - Number of questions: exactly ${section.num_questions}
  - Total marks for the section: ${section.marks}
  - ${marksGuide}
  - ${marksHardCap}
  - Bloom's level focus: ${section.bloom ?? "Apply"} (use other levels only if the topic clearly demands it)
  ${section.instructions ? `- Section instructions for the rubric: ${section.instructions}` : ""}
${skillBlock}${difficultyBlock}${objectivesBlock}
${humanitiesSourceGuidance}${sbqSectionPreamble}${historyEssayBlock}
${(() => {
  // When the caller has narrowed topic_pool to exactly one entry per question
  // (e.g. Combined Science Paper 1 with a planned Physics/Chemistry split), we
  // emit a strict per-question topic+discipline assignment so each MCQ is
  // anchored to the planned slot. This is what enforces the 50/50 split.
  if (section.topic_pool.length !== section.num_questions || section.num_questions < 2) return "";
  const disciplines = section.topic_pool.map((t) => (t.section ?? "").trim());
  const distinct = new Set(disciplines.filter(Boolean));
  if (distinct.size < 2) return "";
  const lines = section.topic_pool.map((t, i) => {
    const disc = (t.section ?? "Other").trim() || "Other";
    const code = t.topic_code ? ` [${t.topic_code}]` : "";
    const losPreview = (t.learning_outcomes ?? []).slice(0, 2).map((lo) => lo.length > 90 ? lo.slice(0, 87) + "…" : lo);
    const losStr = losPreview.length > 0 ? ` — target LO(s): ${losPreview.join(" | ")}` : "";
    return `  - Question ${i + 1}: discipline=${disc}; topic=${t.topic}${code}${losStr}`;
  }).join("\n");
  const totals = Array.from(distinct).map((d) => `${d}=${disciplines.filter((x) => x === d).length}`).join(", ");
  return `
PER-QUESTION TOPIC ASSIGNMENT (HARD CONSTRAINT — write each question on EXACTLY the assigned topic and discipline; do NOT swap, merge or skip any slot):
${lines}

DISCIPLINE BALANCE for this section: ${totals}. Each question's stem, options, working and tags must clearly belong to its assigned discipline. The set of learning_outcomes you tag on each question MUST be drawn from that question's target LO(s) above (verbatim copies from the syllabus pool). Across the section, COLLECTIVELY cover as many distinct learning outcomes as the slots allow — repeat an LO only if the slot count exceeds the available LO count.
`;
})()}
ALLOWED TOPICS (pick from these only — DO NOT invent topics outside this pool):
${topicLines}
${sourceBlocks}

${opts.instructions ? `TEACHER INSTRUCTIONS (apply to all questions):\n${opts.instructions}\n` : ""}
For every question:
  - question_type MUST be exactly "${section.question_type}".
  - For MCQ provide exactly 4 options as an array; for non-MCQ, options must be null.
  - difficulty: easy | medium | hard.
  - bloom_level: Remember | Understand | Apply | Analyse | Evaluate | Create.
  - The topic field must be one of the allowed topics above (verbatim).
  - ao_codes, knowledge_outcomes, learning_outcomes: the SPECIFIC objectives this question addresses (drawn from the pools above where provided).
${section.question_type === "source_based" || section.question_type === "comprehension"
    ? `  - Each sub-question must explicitly NAME the source(s) it uses by letter and require analysis/inference — never generic content recall that ignores the source.`
    : ""}

Call the tool save_assessment with the full list of ${section.num_questions} questions for this section.`;
}

const TOOL = {
  type: "function",
  function: {
    name: "save_assessment",
    description: "Save the questions for this assessment section.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_type: { type: "string", enum: ["mcq", "short_answer", "structured", "long", "comprehension", "practical", "source_based"] },
              topic: { type: "string" },
              bloom_level: { type: "string", enum: ["Remember", "Understand", "Apply", "Analyse", "Evaluate", "Create"] },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              marks: { type: "integer", minimum: 1 },
              stem: { type: "string", description: "The question text. For structured questions include sub-parts (a), (b), etc. For source-based questions include the verbatim Source A block + citation, then the sub-parts." },
              options: { type: ["array", "null"], items: { type: "string" }, description: "MCQ options or null." },
              answer: { type: "string", description: "The correct answer. For MCQ: the letter and option text. For source_based: a fully-written L4 candidate exemplar in the candidate's voice (NOT a meta-description) that performs the L4 moves of the assigned LORMS skill (e.g. quoted source evidence + provenance + bias + reasoned judgement, where appropriate). For long/essay: a full model essay." },
              mark_scheme: { type: "string", description: "Marking rubric showing how to award marks." },
              source_excerpt: { type: ["string", "null"], description: "Verbatim source passage used in the stem (only when a GROUNDED SOURCE was provided)." },
              source_url: { type: ["string", "null"], description: "URL of the source (only when a GROUNDED SOURCE was provided)." },
              ao_codes: { type: ["array", "null"], items: { type: "string" }, description: "EVERY Assessment Objective code the stem (and any sub-parts) actually demands — not just the most central one. A 6-mark item that asks the student to describe AND explain tags both AO1 and AO2." },
              knowledge_outcomes: { type: ["array", "null"], items: { type: "string" }, description: "EVERY Knowledge Outcome category the question demands (Knowledge / Understanding / Application / Skills). A compare/explain question typically tags both Skills and Understanding." },
              learning_outcomes: { type: ["array", "null"], items: { type: "string" }, description: "EVERY Learning Outcome statement the stem (and sub-parts and model answer) genuinely demonstrates, copied verbatim from the section pool. Most multi-part questions tag 2–4 LOs." },
            },
            required: ["question_type", "topic", "bloom_level", "difficulty", "marks", "stem", "answer", "mark_scheme"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
};

// ---------- AI gateway with retry ----------

async function callAI(
  messages: Array<{ role: string; content: string }>,
  opts: { model?: string; timeoutMs?: number; maxAttempts?: number } = {},
): Promise<{ ok: boolean; status: number; json?: any; errText?: string }> {
  const model = opts.model ?? "google/gemini-2.5-flash";
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const maxAttempts = opts.maxAttempts ?? 1;
  const aiBody = JSON.stringify({
    model,
    messages,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "save_assessment" } },
  });
  let aiResp: Response | null = null;
  let lastErrTxt = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: aiBody,
        signal: ctrl.signal,
      });
    } catch (e) {
      lastErrTxt = `fetch error: ${(e as Error).message}`;
      console.warn(`[generate] AI attempt ${attempt + 1} threw`, lastErrTxt);
      clearTimeout(t);
      if (attempt < maxAttempts - 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      return { ok: false, status: 504, errText: lastErrTxt };
    }
    clearTimeout(t);
    if (aiResp.ok) break;
    lastErrTxt = await aiResp.text().catch(() => "");
    const transient = aiResp.status === 502 || aiResp.status === 503 || aiResp.status === 504 || aiResp.status === 429;
    console.warn(`[generate] AI attempt ${attempt + 1} failed status=${aiResp.status} transient=${transient}`);
    if (!transient) break;
    if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!aiResp || !aiResp.ok) {
    return { ok: false, status: aiResp?.status ?? 500, errText: lastErrTxt };
  }
  const json = await aiResp.json();
  return { ok: true, status: 200, json };
}

// ---------- Main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let statusAssessmentId: string | null = null;
  // deno-lint-ignore no-explicit-any
  let statusClient: any = null;
  const markAssessmentStatus = async (status: string) => {
    if (!statusClient || !statusAssessmentId) return;
    await statusClient.from("assessments").update({ status }).eq("id", statusAssessmentId);
  };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    statusClient = supabase;

    const body = await req.json();
    const {
      assessmentId, title, subject, level, assessmentType, durationMinutes,
      totalMarks, blueprint, questionTypes, instructions,
      userId: bodyUserId,
      syllabusCode, paperCode,
    } = body;
    statusAssessmentId = assessmentId;
    await markAssessmentStatus("generating");
    const userId = bodyUserId ?? "00000000-0000-0000-0000-000000000001";

    const fallbackTypes = Array.isArray(questionTypes) ? questionTypes : [];
    const sections = toSections(blueprint, "structured", fallbackTypes);
    if (sections.length === 0) {
        await markAssessmentStatus("generation_failed");
        return new Response(JSON.stringify({ error: "Blueprint has no sections" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const subjectKind = classifySubject(subject);
    const scienceMathKind = classifyScienceMath(subject);

    // Fetch past-paper exemplars once for the whole paper (style anchor).
    let exemplarBlock = "";
    try {
      const ex = await fetchExemplars(supabase, subject, level);
      exemplarBlock = ex.block;
      console.log(`[generate] exemplars: ${ex.paperCount} papers, ${ex.questionCount} questions`);
    } catch (e) {
      console.warn("[generate] exemplar fetch failed", e);
    }

    // Shared dedup sets so no two questions across the whole paper reuse a source.
    const usedHosts = new Set<string>();
    const usedUrls = new Set<string>();

    type EnrichedRow = {
      assessment_id: string; user_id: string; position: number;
      question_type: string; topic: string | null; bloom_level: string | null;
      difficulty: string | null; marks: number; stem: string;
      options: string[] | null; answer: string | null; mark_scheme: string | null;
      source_excerpt: string | null; source_url: string | null; notes: string | null;
      diagram_url: string | null; diagram_source: string | null;
      diagram_citation: string | null; diagram_caption: string | null;
      ao_codes: string[]; knowledge_outcomes: string[]; learning_outcomes: string[];
    };

    const allRows: EnrichedRow[] = [];
    let droppedNoSource = 0;
    let groundedCount = 0;
    let diagramCount = 0;
    let sectionFailures = 0;
    // Track diagram URLs already used in this assessment to avoid repeating
    // the same figure across multiple questions.
    const usedDiagramUrls = new Set<string>();

    // Build a per-section topic plan: one SectionTopic slot per question.
    //
    // Default behaviour: round-robin across the section's topic_pool so every
    // topic is touched at least once before any topic repeats.
    //
    // Combined Science (5086) Paper 1 (MCQ) override: SEAB Paper 1 is 40 MCQs
    // split 50/50 Physics + Chemistry. When the subject looks like Combined
    // Science AND the section is MCQ AND the pool spans multiple disciplines
    // (i.e. topic_pool entries carry different `section` labels like "Physics"
    // and "Chemistry"), we interleave the disciplines so the first half of the
    // section is balanced even if the AI fails some slots. Within each
    // discipline we round-robin topics, preferring ones whose learning
    // outcomes have not yet been claimed in this section so KO coverage is
    // maximised.
    const isCombinedScience = /combined\s*science/i.test(String(subject ?? "")) ||
      String(syllabusCode ?? "").trim() === "5086";

    const buildBalancedPlan = (s: Section): (SectionTopic | null)[] => {
      const n = s.num_questions;
      if (s.topic_pool.length === 0) return Array.from({ length: n }, () => null);

      const wantBalanced = isCombinedScience && s.question_type === "mcq";
      if (!wantBalanced) {
        return Array.from({ length: n }, (_, i) => s.topic_pool[i % s.topic_pool.length]);
      }

      // Group by discipline (section label). Practical / unlabelled fall into "Other".
      const groups = new Map<string, SectionTopic[]>();
      for (const t of s.topic_pool) {
        const key = (t.section ?? "Other").trim() || "Other";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(t);
      }
      // Prefer Physics + Chemistry as the two interleave tracks when present.
      const preferredOrder = ["Physics", "Chemistry"];
      const trackKeys = [
        ...preferredOrder.filter((k) => groups.has(k)),
        ...Array.from(groups.keys()).filter((k) => !preferredOrder.includes(k)),
      ];
      if (trackKeys.length < 2) {
        // Pool is single-discipline — fall back to plain round-robin.
        return Array.from({ length: n }, (_, i) => s.topic_pool[i % s.topic_pool.length]);
      }

      // For each track, maintain (a) a rotating index over its topics and
      // (b) a set of LOs already used so we can prefer fresh-LO topics first.
      const trackState = new Map<string, { topics: SectionTopic[]; cursor: number; usedLos: Set<string> }>();
      for (const k of trackKeys) {
        trackState.set(k, { topics: groups.get(k)!, cursor: 0, usedLos: new Set() });
      }

      const pickFromTrack = (k: string): SectionTopic => {
        const st = trackState.get(k)!;
        // First-pass coverage: scan once for a topic with an unseen LO.
        for (let i = 0; i < st.topics.length; i++) {
          const idx = (st.cursor + i) % st.topics.length;
          const cand = st.topics[idx];
          const los = cand.learning_outcomes ?? [];
          const hasFresh = los.length === 0 || los.some((lo) => !st.usedLos.has(lo));
          if (hasFresh) {
            st.cursor = (idx + 1) % st.topics.length;
            for (const lo of los) st.usedLos.add(lo);
            return cand;
          }
        }
        // All LOs already covered — plain round-robin from the cursor.
        const cand = st.topics[st.cursor % st.topics.length];
        st.cursor = (st.cursor + 1) % st.topics.length;
        for (const lo of (cand.learning_outcomes ?? [])) st.usedLos.add(lo);
        return cand;
      };

      // Interleave tracks with marks-weighted balance. For Combined Sci Paper 1
      // (Physics + Chemistry only), a strict 50/50 alternation gives 20+20.
      // With a 3rd track (e.g. Practical), distribute evenly using a
      // largest-remainder schedule so totals match the # questions.
      const baseShare = Math.floor(n / trackKeys.length);
      const remainder = n - baseShare * trackKeys.length;
      const quotas: Record<string, number> = {};
      trackKeys.forEach((k, i) => { quotas[k] = baseShare + (i < remainder ? 1 : 0); });

      // Round-robin across tracks while quota remains.
      const plan: SectionTopic[] = [];
      let safety = n * trackKeys.length + 5;
      let ti = 0;
      while (plan.length < n && safety-- > 0) {
        const k = trackKeys[ti % trackKeys.length];
        if (quotas[k] > 0) {
          plan.push(pickFromTrack(k));
          quotas[k]--;
        }
        ti++;
      }
      return plan;
    };

    // Per-section cached plan. Built lazily once per section.
    const sectionPlans = new Map<number, (SectionTopic | null)[]>();
    const pickTopic = (s: Section, qIdx: number, sIdx: number = 0): SectionTopic | null => {
      if (s.topic_pool.length === 0) return null;
      let plan = sectionPlans.get(sIdx);
      if (!plan) { plan = buildBalancedPlan(s); sectionPlans.set(sIdx, plan); }
      return plan[qIdx] ?? s.topic_pool[qIdx % s.topic_pool.length];
    };

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      console.log(`[generate] section ${section.letter} (${section.question_type}) — ${section.num_questions} questions, ${section.marks} marks`);

      // Decide which questions in this section need a grounded source.
      // Humanities + non-essay = always; English + (source_based|comprehension) = always; otherwise none.
      const isHumanitiesNonEssay =
        subjectKind === "humanities" &&
        section.question_type !== "long" &&
        section.question_type !== "structured";
      const isEnglishSourcey =
        subjectKind === "english" &&
        (section.question_type === "source_based" || section.question_type === "comprehension");
      const needsSourcePerQ = isHumanitiesNonEssay || isEnglishSourcey;

      // Determine sources per question. SBQ skills like comparison/assertion need
      // multiple sources packed INTO a single question stem (Source A, B, C…).
      // With multi-skill support, each question can have its own minSources.
      const effectiveSkillIds = resolveEffectiveSkills(section);
      const effectiveSkillDefs = effectiveSkillIds.map((id) => SBQ_SKILLS[id]).filter(Boolean);
      const perQSkillsForFetch = assignSkillsToQuestions(effectiveSkillDefs, section.num_questions);

      // For HUMANITIES SBQ sections: build ONE shared pool of Sources A–E that
      // all sub-questions in the section reference. The section is anchored on
      // ONE key inquiry question for ONE topic, mirroring SEAB SBQ paper format.
      const isHumanitiesSBQ = subjectKind === "humanities" && section.question_type === "source_based";
      const sharedSourcePool: GroundedSource[] = [];
      const sharedImageSources: GroundedImageSource[] = [];
      const sourcesForSection: (GroundedSource | null)[][] = [];

      if (isHumanitiesSBQ) {
        // SEAB History SBQ papers cap at ~6 sources total. We reserve up to 1
        // slot for a pictorial primary source and up to 5 slots for documentary
        // text sources. Hard ceiling of 6.
        //
        // PERF: this whole block is the dominant cost of History generation.
        // We previously did:
        //   curated seed → live text fetch → rescue text fetch → image fetch
        //                → AI provenance call
        // which routinely tripped the function's CPU limit. We now:
        //   curated seed (up to 4) → live text fetch ONLY if curated under-
        //   delivered → no rescue → 1 quick image fetch → deterministic
        //   provenance (no AI).
        const MAX_TOTAL_SOURCES = 6;
        const MAX_IMAGE_SOURCES = 1;
        const maxMinSources = effectiveSkillDefs.reduce((m, s) => Math.max(m, s.minSources), 0);
        const poolSize = Math.min(MAX_TOTAL_SOURCES, Math.max(4, maxMinSources));
        const sectionTopic = section.topic_pool[0] ?? null;
        const POOL_QUERY_HINTS = [
          "official government statement",
          "newspaper report contemporary",
          "speech address transcript",
          "memoir eyewitness account",
          "historian scholarly analysis",
          "political cartoon poster propaganda",
        ];
        if (sectionTopic) {
          // Seed generously from curated bundles. If they already cover the
          // section, we skip live web fetching entirely — that is what keeps
          // History SBQ generation under the CPU budget.
          const CURATED_SEED_CAP = 4;
          const SKIP_LIVE_THRESHOLD = 4;
          const hostOf = (u: string): string => {
            try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
          };
          // CRITICAL: enforce DISTINCT hosts when seeding from curated bundles.
          // Several bundles contain multiple excerpts from the same publisher
          // (e.g. 3× nationalarchives.gov.uk, 3× ushmm.org). Without this guard
          // the SBQ pool shipped with all sources from one or two domains —
          // teachers complained that source diversity was missing.
          const curatedAll = curatedHumanitiesSourcePool(sectionTopic.topic, sectionTopic.learning_outcomes ?? []);
          const curatedSeed: typeof curatedAll = [];
          const seenSeedHosts = new Set<string>();
          // Pass 1: take one source per distinct host, in bundle order.
          for (const src of curatedAll) {
            if (curatedSeed.length >= CURATED_SEED_CAP) break;
            const h = hostOf(src.source_url);
            if (!h || seenSeedHosts.has(h)) continue;
            seenSeedHosts.add(h);
            curatedSeed.push(src);
          }
          // Pass 2: only if we still don't have enough distinct-host options
          // (small bundle), top up from remaining curated sources allowing
          // host repeats — but log the dup so we can spot weak bundles.
          if (curatedSeed.length < CURATED_SEED_CAP) {
            for (const src of curatedAll) {
              if (curatedSeed.length >= CURATED_SEED_CAP) break;
              if (curatedSeed.some((s) => s.source_url === src.source_url)) continue;
              curatedSeed.push(src);
              console.warn(`[generate] section ${section.letter}: curated bundle thin — reusing host ${hostOf(src.source_url)} for second excerpt`);
            }
          }
          sharedSourcePool.push(...curatedSeed);
          for (const src of curatedSeed) {
            usedUrls.add(src.source_url);
            const h = hostOf(src.source_url);
            if (h) usedHosts.add(h);
          }
          const distinctSeedHosts = new Set(curatedSeed.map((s) => hostOf(s.source_url)).filter(Boolean));
          console.log(`[generate] section ${section.letter}: seeded ${curatedSeed.length} curated source(s) across ${distinctSeedHosts.size} distinct host(s); ${sharedSourcePool.length >= SKIP_LIVE_THRESHOLD ? "SKIPPING live text fetch" : "will run live text fetch"}`);

          // Per-pool budget: at most ONE Tier-2 (historian) source, shared
          // across parallel fetches.
          const tierBudget: TierBudget = { tier2Used: 0, maxTier2: 1 };
          const FETCH_TARGET = Math.max(0, MAX_TOTAL_SOURCES - MAX_IMAGE_SOURCES);
          const PER_FETCH_TIMEOUT_MS = 8000;
          const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
            new Promise((resolve) => {
              const t = setTimeout(() => resolve(null), ms);
              p.then((v) => { clearTimeout(t); resolve(v); })
               .catch(() => { clearTimeout(t); resolve(null); });
            });

          // ONLY run live text fetches if curated didn't already cover us.
          if (sharedSourcePool.length < SKIP_LIVE_THRESHOLD) {
            const remaining = Math.max(0, Math.min(poolSize, FETCH_TARGET) - sharedSourcePool.length);
            const settled = await Promise.all(
              Array.from({ length: remaining }, (_, i) =>
                withTimeout(
                  fetchGroundedSource(
                    subjectKind, sectionTopic.topic, sectionTopic.learning_outcomes ?? [],
                    usedHosts, usedUrls, POOL_QUERY_HINTS[i % POOL_QUERY_HINTS.length],
                    tierBudget,
                  ),
                  PER_FETCH_TIMEOUT_MS,
                ).catch((e) => {
                  console.warn("[generate] shared source fetch failed for", sectionTopic.topic, e);
                  return null;
                }),
              ),
            );
            for (const src of settled) {
              if (src) sharedSourcePool.push(src);
            }
          }

          // Belt-and-suspenders: even with the shared tierBudget, parallel
          // fetches can race past the cap. Drop excess Tier-2 sources here.
          let tier2Kept = 0;
          const trimmed: typeof sharedSourcePool = [];
          for (const src of sharedSourcePool) {
            const host = (() => { try { return new URL(src.source_url).hostname.toLowerCase(); } catch { return ""; } })();
            if (humanitiesTier(host) === 2) {
              if (tier2Kept >= 1) {
                console.warn(`[generate] dropping excess Tier-2 source ${host} from SBQ pool`);
                continue;
              }
              tier2Kept++;
            }
            trimmed.push(src);
          }
          sharedSourcePool.length = 0;
          sharedSourcePool.push(...trimmed);

          // Backfill from curated only — no second live "rescue" round, which
          // was the worst CPU offender. If curated still can't reach the
          // target we ship with what we have (>=2 is enough for an SBQ).
          if (sharedSourcePool.length < FETCH_TARGET) {
            const curated = curatedHumanitiesSourcePool(
              sectionTopic.topic,
              sectionTopic.learning_outcomes ?? [],
            );
            // Backfill PASS 1: prefer NEW hosts not already represented in
            // the pool, to keep source diversity.
            for (const src of curated) {
              if (sharedSourcePool.length >= poolSize) break;
              if (usedUrls.has(src.source_url)) continue;
              if (sharedSourcePool.some((s) => s.source_url === src.source_url)) continue;
              const h = hostOf(src.source_url);
              if (h && usedHosts.has(h)) continue;
              sharedSourcePool.push(src);
              usedUrls.add(src.source_url);
              if (h) usedHosts.add(h);
            }
            // Backfill PASS 2: only if still short, allow same-host duplicates.
            if (sharedSourcePool.length < FETCH_TARGET) {
              for (const src of curated) {
                if (sharedSourcePool.length >= poolSize) break;
                if (usedUrls.has(src.source_url)) continue;
                if (sharedSourcePool.some((s) => s.source_url === src.source_url)) continue;
                sharedSourcePool.push(src);
                usedUrls.add(src.source_url);
                const h = hostOf(src.source_url);
                if (h) usedHosts.add(h);
                console.warn(`[generate] section ${section.letter}: backfill reusing host ${h} (curated bundle exhausted)`);
              }
            }
          }
          if (sharedSourcePool.length < FETCH_TARGET) {
            console.warn(`[generate] section ${section.letter}: text pool ${sharedSourcePool.length}/${FETCH_TARGET} after curated backfill; continuing without live rescue`);
          }

          // Pictorial primary source: at most ONE, on a tight time budget.
          // If nothing is found quickly we just ship without an image rather
          // than blocking the section.
          try {
            const imgs = await fetchGroundedImageSources(
              sectionTopic.topic,
              sectionTopic.learning_outcomes ?? [],
              MAX_IMAGE_SOURCES,
              usedHosts,
            );
            for (const img of imgs.slice(0, MAX_IMAGE_SOURCES)) {
              sharedImageSources.push(img);
              console.log(`[generate] section ${section.letter}: pictorial source ${img.image_url} from ${img.publisher}`);
            }
            if (imgs.length === 0) {
              console.log(`[generate] section ${section.letter}: no pictorial source found (continuing without)`);
            }
          } catch (e) {
            console.warn(`[generate] section ${section.letter}: image source fetch failed`, (e as Error).message);
          }
        }
        // Hard cap: text sources never exceed (MAX_TOTAL_SOURCES - imagesFound)
        // so the section ships with ≤ MAX_TOTAL_SOURCES (= 6) sources total.
        const imagesCount = Math.min(sharedImageSources.length, MAX_IMAGE_SOURCES);
        const textCap = Math.max(0, MAX_TOTAL_SOURCES - imagesCount);
        if (sharedSourcePool.length > textCap) {
          sharedSourcePool.length = textCap;
        }
        if (sharedImageSources.length > MAX_IMAGE_SOURCES) {
          sharedImageSources.length = MAX_IMAGE_SOURCES;
        }
        const finalHosts = new Set(
          sharedSourcePool.map((s) => { try { return new URL(s.source_url).hostname.toLowerCase(); } catch { return ""; } }).filter(Boolean),
        );
        console.log(`[generate] section ${section.letter} SBQ pool: ${sharedSourcePool.length} text sources across ${finalHosts.size} distinct host(s) + ${sharedImageSources.length} image(s) (cap ${MAX_TOTAL_SOURCES} total, ${MAX_IMAGE_SOURCES} pictorial)`);
        if (subjectKind === "humanities" && sharedSourcePool.length >= 3 && finalHosts.size < 3) {
          console.warn(`[generate] section ${section.letter}: LOW source diversity — ${sharedSourcePool.length} excerpts but only ${finalHosts.size} distinct host(s): ${[...finalHosts].join(", ")}`);
        }

        // Hard floor: an SBQ section needs at least 2 distinct sources.
        if (sharedSourcePool.length < 2) {
          console.warn(`[generate] section ${section.letter}: SBQ pool only has ${sharedSourcePool.length} source(s); skipping section`);
          sectionFailures++;
          continue;
        }

        // Deterministic provenance — no AI call. This used to be an extra
        // model round-trip after sources were already chosen, which was
        // pure CPU/wall-clock cost. Use publisher + title instead.
        for (const s of sharedSourcePool) {
          if (!s.provenance) s.provenance = `From ${s.publisher}: ${s.source_title}.`;
        }
        for (const img of sharedImageSources) {
          if (!img.provenance) img.provenance = `From ${img.publisher}: ${img.source_title}.`;
        }

        // Every question slot references the SAME shared pool.
        for (let qi = 0; qi < section.num_questions; qi++) {
          sourcesForSection.push(sharedSourcePool.slice());
        }
      } else if (needsSourcePerQ && subjectKind) {
        // Non-SBQ humanities or English comprehension: per-question source.
        for (let qi = 0; qi < section.num_questions; qi++) {
          const t = pickTopic(section, qi, si);
          const qSkill = perQSkillsForFetch[qi];
          const sourcesPerQ = qSkill ? Math.max(1, qSkill.minSources) : 1;
          const slot: (GroundedSource | null)[] = [];
          if (!t) {
            for (let i = 0; i < sourcesPerQ; i++) slot.push(null);
          } else {
            for (let i = 0; i < sourcesPerQ; i++) {
              try {
                const src = await fetchGroundedSource(subjectKind, t.topic, t.learning_outcomes ?? [], usedHosts, usedUrls);
                slot.push(src);
              } catch (e) {
                console.warn("[generate] source fetch failed for", t.topic, e);
                slot.push(null);
              }
            }
          }
          sourcesForSection.push(slot);
        }
      } else {
        for (let qi = 0; qi < section.num_questions; qi++) sourcesForSection.push([null]);
      }

      // Plan per-question difficulty targets for this section (if a mix is set
      // AND we are not in a deterministic SBQ section). Targets are sliced per
      // chunk and used both in the prompt and as the saved value of `difficulty`.
      const sectionDifficultyTargets = section.difficulty_mix
        ? assignDifficultyToQuestions(section.difficulty_mix, section.num_questions)
        : null;

      let questions: any[] = [];
      if (isHumanitiesSBQ && sharedSourcePool.length > 0) {
        console.log(`[generate] section ${section.letter}: using deterministic SBQ builder to avoid long AI timeout`);
        questions = buildDeterministicSbqQuestions(section, sharedSourcePool, perQSkillsForFetch);
      } else {
        // Chunk large sections so a single AI call never has to emit too many
        // questions at once (gateway times out around 60s; 40 MCQs in one shot
        // reliably aborts). We split into batches of CHUNK_SIZE and stitch the
        // results back together.
        const CHUNK_SIZE = section.question_type === "mcq" ? 10 : 8;
        const totalQs = section.num_questions;
        const numChunks = Math.max(1, Math.ceil(totalQs / CHUNK_SIZE));

        // Run all chunks in PARALLEL — each chunk is an independent AI call,
        // so awaiting them sequentially was the main reason large sections
        // (e.g. 40 MCQs = 4 chunks × ~30s) blew past the 150s edge-function
        // timeout. Parallelism collapses that to ~the slowest single chunk.
        const chunkPromises = Array.from({ length: numChunks }, async (_unused, c) => {
          const startIdx = c * CHUNK_SIZE;
          const endIdx = Math.min(totalQs, startIdx + CHUNK_SIZE);
          const chunkQCount = endIdx - startIdx;

          const chunkMarks = Math.max(
            chunkQCount,
            Math.round((section.marks * chunkQCount) / totalQs),
          );
          const plannedSlice: SectionTopic[] = [];
          for (let qi = startIdx; qi < endIdx; qi++) {
            const t = pickTopic(section, qi, si);
            if (t) plannedSlice.push(t);
          }
          const chunkTopicPool = plannedSlice.length > 0
            ? plannedSlice
            : section.topic_pool;
          const chunkSection: Section = {
            ...section,
            num_questions: chunkQCount,
            marks: chunkMarks,
            topic_pool: chunkTopicPool,
          };
          const chunkSources = sourcesForSection.slice(startIdx, endIdx);
          const chunkDifficultyTargets = sectionDifficultyTargets
            ? sectionDifficultyTargets.slice(startIdx, endIdx)
            : undefined;

          const messages: Array<{ role: string; content: string }> = [
            { role: "system", content: buildSystemPrompt(subject, level, paperCode) },
          ];
          if (exemplarBlock) messages.push({ role: "system", content: exemplarBlock });
          if (numChunks > 1) {
            messages.push({
              role: "system",
              content: `This section has ${totalQs} questions total; you are generating questions ${startIdx + 1}–${endIdx} (batch ${c + 1} of ${numChunks}). Generate EXACTLY ${chunkQCount} questions. Other batches are being generated in parallel — focus only on your assigned slot range.`,
            });
          }
          messages.push({
            role: "user",
            content: buildSectionUserPrompt({
              title, subject, level, assessmentType, totalMarks, durationMinutes,
              section: chunkSection, sectionIndex: si, totalSections: sections.length,
              syllabusCode, paperCode, groundedSources: chunkSources,
              sharedSourcePool: isHumanitiesSBQ ? sharedSourcePool : undefined,
              sharedImageSources: isHumanitiesSBQ ? sharedImageSources : [],
              subjectKind, instructions,
              difficultyTargets: chunkDifficultyTargets,
            }),
          });

          const ai = await callAI(messages);
          if (!ai.ok) {
            console.error(`[generate] section ${section.letter} chunk ${c + 1}/${numChunks} AI error`, ai.status, (ai.errText ?? "").slice(0, 300));
            return { ok: false as const, c, qs: [] as any[] };
          }
          const toolCall = ai.json?.choices?.[0]?.message?.tool_calls?.[0];
          if (!toolCall) {
            console.error(`[generate] section ${section.letter} chunk ${c + 1}/${numChunks}: no tool call`, JSON.stringify(ai.json).slice(0, 300));
            return { ok: false as const, c, qs: [] as any[] };
          }
          let parsed: { questions?: any[] };
          try { parsed = JSON.parse(toolCall.function.arguments); }
          catch {
            return { ok: false as const, c, qs: [] as any[] };
          }
          const chunkQs = parsed.questions ?? [];
          console.log(`[generate] section ${section.letter} chunk ${c + 1}/${numChunks}: produced ${chunkQs.length} questions`);
          return { ok: true as const, c, qs: chunkQs };
        });

        const chunkResults = await Promise.all(chunkPromises);
        // Re-stitch in chunk order so question slots line up with sourcesForSection.
        chunkResults.sort((a, b) => a.c - b.c);
        let chunkFailed = false;
        for (const r of chunkResults) {
          if (!r.ok) chunkFailed = true;
          questions.push(...r.qs);
        }
        console.log(`[generate] section ${section.letter}: parallel chunks done — ${questions.length}/${totalQs} questions`);

        if (chunkFailed && questions.length === 0) {
          sectionFailures++;
          continue;
        }
      }

      // HARD CAP enforcement (all subjects): the section must contain EXACTLY
      // `section.num_questions` questions, and the sum of marks must equal
      // `section.marks`. The model is told this in the prompt but we never
      // trust it. SBQ sections built deterministically already match exactly;
      // this catches AI-generated sections that returned too few or too many.
      if (questions.length > section.num_questions) {
        console.warn(`[generate] section ${section.letter}: AI returned ${questions.length} questions, trimming to ${section.num_questions}`);
        questions = questions.slice(0, section.num_questions);
      } else if (questions.length > 0 && questions.length < section.num_questions) {
        const missing = section.num_questions - questions.length;
        console.warn(`[generate] section ${section.letter}: AI returned ${questions.length} questions, padding ${missing} stub(s) to reach ${section.num_questions}`);
        const fallbackTopic = section.topic_pool[0]?.topic ?? null;
        for (let pad = 0; pad < missing; pad++) {
          questions.push({
            question_type: section.question_type,
            topic: fallbackTopic,
            bloom_level: section.bloom ?? null,
            difficulty: null,
            marks: 1,
            stem: `[Placeholder question ${questions.length + 1} — generation incomplete; please regenerate or edit.]`,
            options: section.question_type === "mcq" ? [{ key: "A", text: "—" }, { key: "B", text: "—" }, { key: "C", text: "—" }, { key: "D", text: "—" }] : null,
            answer: null,
            mark_scheme: null,
          });
        }
      }

      if (questions.length > 0) {
        const lockedIndices = new Set<number>();
        if (isHumanitiesSBQ) {
          // Lock SBQ skills marked `locked: true` (currently: assertion at 8 marks).
          for (let qi = 0; qi < perQSkillsForFetch.length && qi < questions.length; qi++) {
            const sk = perQSkillsForFetch[qi];
            if (sk?.locked) lockedIndices.add(qi);
          }
        }
        const before = questions.reduce((a, q: any) => a + (q.marks ?? 0), 0);
        normalizeSectionMarks(questions as any, section.marks, lockedIndices);
        const after = questions.reduce((a, q: any) => a + (q.marks ?? 0), 0);
        if (before !== after) {
          console.log(`[generate] section ${section.letter} marks normalized: ${before} → ${after} (target ${section.marks})`);
        }
      }
      // Per-question post-processing: enforce source attachment, drop unsupported.
      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi];
        const expectedSlot = sourcesForSection[qi] ?? [];
        const validSources = expectedSlot.filter((s): s is GroundedSource => !!s);
        const expectedSrc = validSources[0] ?? null;
        let question_type: string = section.question_type; // FORCE section's type
        let source_excerpt: string | null = q.source_excerpt ?? null;
        let source_url: string | null = q.source_url ?? null;
        let notes: string | null = null;

        if (isHumanitiesSBQ) {
          // SBQ section uses ONE shared pool of Sources A–E. Every sub-question
          // gets the same concatenated excerpt and the same source URL.
          if (sharedSourcePool.length === 0) {
            console.warn(`[generate] section ${section.letter} q${qi + 1}: shared SBQ pool is empty — dropping`);
            droppedNoSource++;
            continue;
          }
          question_type = "source_based";
          // Defensive sanitiser: strip our marker tokens from any free-text
          // field so they can't break the parser if a publisher / excerpt
          // happens to contain "[PROV]" / "[URL]" / "[TEXT]" / "[IMAGE]".
          const stripMarkers = (s: string) => (s ?? "").replace(/\[(PROV|URL|TEXT|IMAGE)\]/g, "");
          const textBlocks = sharedSourcePool.map((s, i) => {
            const label = String.fromCharCode(65 + i);
            const prov = stripMarkers(s.provenance ?? `From ${s.publisher}.`);
            const url = stripMarkers(s.source_url ?? "");
            const excerpt = stripMarkers(s.excerpt ?? "");
            return `Source ${label}: [PROV] ${prov} [URL] ${url} [TEXT] ${excerpt}`;
          });
          // Append each pictorial source as a separate Source label using the
          // [IMAGE] marker the renderer recognises (parseSharedSourcePool in
          // src/routes/assessment.$id.tsx handles multiple image markers and
          // the [PROV]/[URL] markers we attach here).
          sharedImageSources.forEach((img, i) => {
            const imgLabel = String.fromCharCode(65 + sharedSourcePool.length + i);
            const prov = stripMarkers(img.provenance ?? `From ${img.publisher}.`);
            const url = stripMarkers(img.source_url ?? "");
            const caption = stripMarkers(img.caption ?? "");
            textBlocks.push(
              `Source ${imgLabel}: [IMAGE] ${caption} — ${img.image_url} [PROV] ${prov} [URL] ${url}`,
            );
          });
          source_excerpt = textBlocks.join("\n\n");
          source_url = sharedSourcePool[0].source_url;
          groundedCount++;
        } else if (needsSourcePerQ) {
          if (!expectedSrc) {
            droppedNoSource++;
            continue;
          }
          const qSkillForCheck = perQSkillsForFetch[qi];
          if (qSkillForCheck && validSources.length < qSkillForCheck.minSources) {
            console.warn(`[generate] section ${section.letter} q${qi + 1}: ${qSkillForCheck.label} needs ${qSkillForCheck.minSources} sources, got ${validSources.length} — dropping`);
            droppedNoSource++;
            continue;
          }
          if (subjectKind === "humanities") question_type = "source_based";
          if (validSources.length > 1) {
            source_excerpt = validSources
              .map((s, i) => `Source ${String.fromCharCode(65 + i)}: ${s.excerpt}`)
              .join("\n\n");
          } else {
            source_excerpt = expectedSrc.excerpt;
          }
          source_url = expectedSrc.source_url;
          if (validSources.length === 1 && q.source_excerpt !== expectedSrc.excerpt) {
            notes = "Source excerpt enforced from retrieved citation (model attempted to alter it).";
          }
          groundedCount++;
        } else {
          source_excerpt = null;
          source_url = null;
        }

        // Decide whether this question wants a diagram (resolved later, in parallel).
        const t = pickTopic(section, qi, si);
        const wantDiagram = !!scienceMathKind && questionWantsDiagram(
          scienceMathKind,
          [question_type],
          q.topic ?? t?.topic ?? "",
          t?.learning_outcomes ?? [],
          q.stem ?? "",
        );

        // Resolve per-question objective tags. Honour what the model emitted;
        // otherwise fall back to the section overrides, then the topic defaults.
        const fallbackAOs = (section.ao_codes && section.ao_codes.length > 0)
          ? section.ao_codes
          : (t?.ao_codes ?? []);
        const fallbackKOs = (section.knowledge_outcomes && section.knowledge_outcomes.length > 0)
          ? section.knowledge_outcomes
          : (t?.outcome_categories ?? []);
        const fallbackLOs = (section.learning_outcomes && section.learning_outcomes.length > 0)
          ? section.learning_outcomes
          : (t?.learning_outcomes ?? []);
        const qAOs: string[] = Array.isArray(q.ao_codes) && q.ao_codes.length > 0 ? q.ao_codes : fallbackAOs;
        const qKOs: string[] = Array.isArray(q.knowledge_outcomes) && q.knowledge_outcomes.length > 0 ? q.knowledge_outcomes : fallbackKOs;
        const qLOs: string[] = Array.isArray(q.learning_outcomes) && q.learning_outcomes.length > 0 ? q.learning_outcomes : fallbackLOs;

        // Semantic post-pass: add LOs/KOs/AOs the stem demonstrably exercises
        // even when the model under-tagged. Only ADDS, never removes.
        const inferKind: "humanities" | "english" | "science_math" | "other" =
          subjectKind === "humanities" ? "humanities"
          : subjectKind === "english" ? "english"
          : scienceMathKind ? "science_math" : "other";
        const poolAOs = (section.ao_codes && section.ao_codes.length > 0)
          ? section.ao_codes
          : Array.from(new Set(section.topic_pool.flatMap((tp) => tp.ao_codes ?? [])));
        const poolKOs = (section.knowledge_outcomes && section.knowledge_outcomes.length > 0)
          ? section.knowledge_outcomes
          : Array.from(new Set(section.topic_pool.flatMap((tp) => tp.outcome_categories ?? [])));
        const poolLOs = (section.learning_outcomes && section.learning_outcomes.length > 0)
          ? section.learning_outcomes
          : Array.from(new Set(section.topic_pool.flatMap((tp) => tp.learning_outcomes ?? [])));
        const expanded = expandQuestionTags(
          { stem: q.stem ?? "", answer: q.answer ?? null, mark_scheme: q.mark_scheme ?? null, topic: q.topic ?? null, options: Array.isArray(q.options) ? q.options : null },
          { ao_codes: qAOs, knowledge_outcomes: qKOs, learning_outcomes: qLOs },
          { loPool: poolLOs, koPool: poolKOs, aoPool: poolAOs },
          inferKind,
        );

        allRows.push({
          assessment_id: assessmentId,
          user_id: userId,
          position: allRows.length,
          question_type,
          topic: q.topic ?? null,
          bloom_level: q.bloom_level ?? section.bloom ?? null,
          difficulty: sectionDifficultyTargets ? sectionDifficultyTargets[qi] ?? q.difficulty ?? null : (q.difficulty ?? null),
          marks: q.marks ?? 1,
          stem: q.stem,
          options: normalizeGeneratedOptions(q.options),
          answer: q.answer ?? null,
          mark_scheme: q.mark_scheme ?? null,
          source_excerpt,
          source_url,
          notes,
          diagram_url: null,
          diagram_source: null,
          diagram_citation: null,
          diagram_caption: null,
          ao_codes: expanded.ao_codes,
          knowledge_outcomes: expanded.knowledge_outcomes,
          learning_outcomes: expanded.learning_outcomes,
          // transient — used by the post-insert diagram pass, stripped before insert
          _wantDiagram: wantDiagram,
          _diagramTopic: q.topic ?? t?.topic ?? "",
          _diagramLOs: t?.learning_outcomes ?? [],
          _diagramKind: scienceMathKind,
        } as EnrichedRow & {
          _wantDiagram: boolean;
          _diagramTopic: string;
          _diagramLOs: string[];
          _diagramKind: typeof scienceMathKind;
        });
      }
    }

    if (droppedNoSource > 0) {
      console.warn(`[generate] dropped ${droppedNoSource} question(s) with no retrievable source`);
    }
    if (sectionFailures > 0) {
      console.warn(`[generate] ${sectionFailures} section(s) failed to generate`);
    }

    if (allRows.length > 0) {
      // Strip transient diagram-planning fields before insert.
      const insertRows = allRows.map((r) => {
        const { _wantDiagram, _diagramTopic, _diagramLOs, _diagramKind, ...rest } = r as any;
        return rest;
      });
      const { data: insertedRows, error: insErr } = await supabase
        .from("assessment_questions")
        .insert(insertRows)
        .select("id, position");
      if (insErr) {
        console.error("Insert error", insErr);
        await markAssessmentStatus("generation_failed");
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ---- Diagram phase: parallel, post-insert. Failures here are non-fatal. ----
      // MCQs / short-answer only consult past papers (cheap DB lookup); structured /
      // practical / comprehension may also fall through to web + AI generation.
      const idByPosition = new Map<number, string>();
      for (const row of insertedRows ?? []) idByPosition.set(row.position, row.id);

      const diagramTasks = allRows
        .map((r, idx) => ({ r: r as any, idx }))
        .filter(({ r }) => r._wantDiagram && r._diagramKind);

      if (diagramTasks.length > 0) {
        // Cap the entire diagram phase by wall-clock so we always reach the
        // final status update. Big MCQ papers (e.g. Combined Science Paper 1
        // with 40 items) used to time out the whole edge function here,
        // leaving the assessment stuck in `generating` even though all
        // questions were already inserted.
        const DIAGRAM_PHASE_BUDGET_MS = 25_000;
        const phaseDeadline = Date.now() + DIAGRAM_PHASE_BUDGET_MS;
        const CONCURRENCY = 8;
        let cursor = 0;
        let skippedAfterDeadline = 0;
        const runOne = async () => {
          while (cursor < diagramTasks.length) {
            if (Date.now() >= phaseDeadline) {
              // Drain remaining tasks without doing any work.
              const remaining = diagramTasks.length - cursor;
              if (remaining > 0) skippedAfterDeadline += remaining;
              cursor = diagramTasks.length;
              break;
            }
            const myIdx = cursor++;
            const { r, idx } = diagramTasks[myIdx];
            const remainingMs = Math.max(1000, phaseDeadline - Date.now());
            try {
              const diag = await fetchDiagram({
                supabase,
                kind: r._diagramKind,
                subject, level,
                topic: r._diagramTopic,
                learningOutcomes: r._diagramLOs,
                stem: r.stem ?? "",
                assessmentId,
                usedUrls: usedDiagramUrls,
                // Per-stage timeouts keep total wall-clock bounded even with
                // 40+ MCQs running 8-wide. Each stage is also capped by the
                // remaining phase budget so a slow tail can't push us past it.
                pastPapersTimeoutMs: Math.min(4000, remainingMs),
                webTimeoutMs: Math.min(8000, remainingMs),
                aiTimeoutMs: Math.min(14000, remainingMs),
              });
              if (diag) {
                usedDiagramUrls.add(diag.url);
                diagramCount++;
                const id = idByPosition.get(r.position);
                if (id) {
                  await supabase.from("assessment_questions").update({
                    diagram_url: diag.url,
                    diagram_source: diag.source,
                    diagram_citation: diag.citation,
                    diagram_caption: diag.caption,
                  }).eq("id", id);
                }
              }
            } catch (e) {
              console.warn(`[generate] diagram task ${idx} failed`, e);
            }
          }
        };
        const workers = Array.from({ length: Math.min(CONCURRENCY, diagramTasks.length) }, runOne);
        // Belt-and-braces: even if a worker hangs, Promise.race ensures we
        // unblock once the budget is exhausted.
        await Promise.race([
          Promise.all(workers),
          new Promise((resolve) => setTimeout(resolve, DIAGRAM_PHASE_BUDGET_MS + 2000)),
        ]);
        if (skippedAfterDeadline > 0) {
          console.warn(`[generate] diagram phase budget exhausted — skipped ${skippedAfterDeadline} of ${diagramTasks.length} diagrams`);
        }
      }
    }

    if (allRows.length === 0) {
      await markAssessmentStatus("generation_failed");
      const error = sectionFailures > 0
        ? "AI service temporarily unavailable. Please try again in a moment."
        : "No usable source-backed questions could be generated for this topic. Please narrow the syllabus topic or try a different source-based section."
      return new Response(JSON.stringify({ error, droppedNoSource, sectionFailures }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await markAssessmentStatus(droppedNoSource > 0 || sectionFailures > 0 ? "draft_partial" : "draft");

    return new Response(JSON.stringify({
      ok: true,
      questionCount: allRows.length,
      groundedCount,
      diagramCount,
      droppedNoSource,
      sectionFailures,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    await markAssessmentStatus("generation_failed");
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
