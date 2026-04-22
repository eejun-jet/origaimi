import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { fetchGroundedSource, classifySubject, type GroundedSource } from "./sources.ts";
import { fetchDiagram, classifyScienceMath, questionWantsDiagram } from "./diagrams.ts";
import { fetchExemplars } from "./exemplars.ts";

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
};

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

const SBQ_SKILLS: Record<string, SbqSkillDef> = {
  inference: {
    id: "inference", label: "Inference", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 1,
    promptHeader: `Write an INFERENCE question. Format: "What can you infer from Source A about [topic]? Explain your answer using details from the source." The student must make an inference (not literal recall) and support it with a quoted detail from Source A.`,
    markScheme: `L1 (1m): Lifts a detail from the source without inferring. L2 (2-3m): Makes a valid inference but lacks supporting evidence from the source. L3 (4-5m): Makes a valid inference with supporting evidence quoted from Source A. L4 (6+m): Makes two well-supported inferences, each with quoted evidence from Source A.`,
  },
  purpose: {
    id: "purpose", label: "Purpose", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 1,
    promptHeader: `Write a PURPOSE question. Format: "Why do you think [author/source] [produced / published / wrote] Source A? Explain your answer using details of the source and your contextual knowledge." The student must identify the author's intended purpose (persuade, warn, glorify, justify, etc.).`,
    markScheme: `L1 (1m): Describes content only, no purpose. L2 (2-3m): States a purpose but does not justify with provenance OR content. L3 (4-5m): States a purpose and supports it with EITHER provenance (who, when, audience) OR specific content evidence. L4 (6+m): States a purpose and supports it with BOTH provenance AND content evidence, plus contextual knowledge.`,
  },
  comparison: {
    id: "comparison", label: "Comparison", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 2,
    promptHeader: `Write a COMPARISON question that requires TWO sources (Source A and Source B). Format: "How similar are Sources A and B? Explain your answer." The student must compare both message AND tone/provenance.`,
    markScheme: `L1 (1-2m): Identifies surface similarities/differences only (e.g. both are about X). L2 (3-4m): Identifies similarities OR differences in message with evidence from both sources. L3 (5-6m): Identifies BOTH similarities AND differences in message, with evidence from both. L4 (7-8m): Compares message AND tone/provenance, with quoted evidence from both sources, and reaches a judgement on overall similarity.`,
  },
  utility: {
    id: "utility", label: "Utility", marks: [6, 7, 8], default: 7, locked: false, minSources: 1,
    promptHeader: `Write a UTILITY question. Format: "How useful is Source A as evidence about [topic]? Explain your answer." The student must evaluate utility from BOTH the content AND the provenance, and acknowledge limitations.`,
    markScheme: `L1 (1-2m): States useful/not useful without justification. L2 (3-4m): Evaluates utility based on content OR provenance only. L3 (5-6m): Evaluates utility based on content AND provenance with evidence. L4 (7-8m): Evaluates utility based on content AND provenance, acknowledges limitations, and reaches an overall judgement.`,
  },
  reliability: {
    id: "reliability", label: "Reliability", marks: [6, 7, 8], default: 7, locked: false, minSources: 1,
    promptHeader: `Write a RELIABILITY question. Format: "How reliable is Source A as evidence about [topic]? Explain your answer." The student must cross-reference content against contextual knowledge AND analyse provenance for bias.`,
    markScheme: `L1 (1-2m): States reliable/unreliable without justification. L2 (3-4m): Evaluates reliability via content cross-reference OR provenance only. L3 (5-6m): Evaluates reliability via content cross-reference AND provenance/bias. L4 (7-8m): Evaluates reliability via content cross-reference, provenance, and bias, with a balanced overall judgement.`,
  },
  surprise: {
    id: "surprise", label: "Surprise", marks: [5, 6, 7, 8], default: 6, locked: false, minSources: 1,
    promptHeader: `Write a SURPRISE question. Format: "Are you surprised by Source A? Explain your answer." The student must explain what IS surprising AND what is NOT surprising, both grounded in contextual knowledge.`,
    markScheme: `L1 (1m): States surprised/not surprised without justification. L2 (2-3m): Explains surprise OR non-surprise using either source content or contextual knowledge. L3 (4-5m): Explains surprise AND non-surprise using contextual knowledge. L4 (6+m): Explains BOTH surprise and non-surprise with detailed contextual knowledge and source evidence, reaching a balanced judgement.`,
  },
  assertion: {
    id: "assertion", label: "Assertion (Hypothesis)", marks: [8], default: 8, locked: true, minSources: 3,
    promptHeader: `Write an ASSERTION (HYPOTHESIS) question worth EXACTLY 8 marks. Format: "'[State a clear historical hypothesis about the topic]'. How far do Sources A, B, C [and D, etc.] support this assertion? Use ALL the sources to explain your answer." The hypothesis must be a debatable claim. The student must use EVERY source provided, evaluating which support and which challenge the hypothesis.`,
    markScheme: `L1 (1-2m): Uses one or two sources only, asserts agree/disagree without evaluation. L2 (3-4m): Uses most sources, identifies which support/challenge but no judgement on weight. L3 (5-6m): Uses ALL sources, identifies support and challenge with evidence, but limited evaluation of source quality. L4 (7-8m): Uses ALL sources, evaluates both support and challenge with evidence, weighs source quality (provenance/bias), and reaches a substantiated overall judgement on how far the assertion is supported.`,
  },
};

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

function buildDeterministicSbqQuestions(section: Section, sources: GroundedSource[], skills: (SbqSkillDef | null)[]): any[] {
  const topic = section.topic_pool[0]?.topic ?? "the issue";
  const inquiry = `How far did the developments in ${topic.replace(/\*$/, "")} shape the issue being studied?`;
  const perQMarks = Math.floor(section.marks / Math.max(1, section.num_questions));
  const remainder = section.marks - perQMarks * section.num_questions;
  const labels = sources.map((_, i) => String.fromCharCode(65 + i));
  const allLabels = labels.join(", ");

  return Array.from({ length: section.num_questions }, (_, i) => {
    const skill = skills[i] ?? null;
    const part = String.fromCharCode(97 + i);
    const marks = skill?.locked ? skill.default : perQMarks + (i < remainder ? 1 : 0);
    const single = labels[i % Math.max(1, labels.length)] ?? "A";
    const second = labels[(i + 1) % Math.max(1, labels.length)] ?? "B";
    const intro = i === 0 ? `${inquiry}\n\n` : "";
    let prompt: string;
    let answer: string;
    let scheme: string;

    if (skill?.id === "comparison") {
      prompt = `Study Sources ${single} and ${second}. (${part}) How similar are Sources ${single} and ${second} in their views about ${topic}? Explain your answer.`;
      answer = `A strong answer compares both sources' messages and uses evidence from Sources ${single} and ${second}, then reaches a judgement on similarity.`;
      scheme = skill.markScheme;
    } else if (skill?.id === "assertion") {
      prompt = `Study Sources ${allLabels}. (${part}) "${topic} was shaped mainly by the actions of the major powers involved." How far do Sources ${allLabels} support this assertion? Explain your answer.`;
      answer = `A strong answer uses every source, groups sources that support and challenge the assertion, evaluates provenance and reaches a balanced judgement.`;
      scheme = skill.markScheme;
    } else if (skill?.id === "utility") {
      prompt = `Study Source ${single}. (${part}) How useful is Source ${single} as evidence about ${topic}? Explain your answer.`;
      answer = `A strong answer evaluates utility using both the content and provenance of Source ${single}, with a limitation and overall judgement.`;
      scheme = skill.markScheme;
    } else if (skill?.id === "reliability") {
      prompt = `Study Source ${single}. (${part}) How reliable is Source ${single} as evidence about ${topic}? Explain your answer.`;
      answer = `A strong answer cross-references the content with contextual knowledge and evaluates the provenance or possible bias of Source ${single}.`;
      scheme = skill.markScheme;
    } else if (skill?.id === "purpose") {
      prompt = `Study Source ${single}. (${part}) Why do you think Source ${single} was produced? Explain your answer using details from the source and your contextual knowledge.`;
      answer = `A strong answer identifies a plausible purpose and supports it with provenance, content evidence and contextual knowledge.`;
      scheme = skill.markScheme;
    } else if (skill?.id === "surprise") {
      prompt = `Study Source ${single}. (${part}) Are you surprised by Source ${single}? Explain your answer.`;
      answer = `A strong answer explains what is surprising and not surprising using details from Source ${single} and contextual knowledge.`;
      scheme = skill.markScheme;
    } else {
      prompt = `Study Source ${single}. (${part}) What can you infer from Source ${single} about ${topic}? Explain your answer using details from the source.`;
      answer = `A strong answer makes a valid inference and supports it with precise evidence from Source ${single}.`;
      scheme = SBQ_SKILLS.inference.markScheme;
    }

    return {
      question_type: "source_based",
      topic,
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
  subjectKind?: "humanities" | "english" | null;
  instructions?: string;
  /** Per-question difficulty targets for THIS chunk (length === section.num_questions). */
  difficultyTargets?: ("easy" | "medium" | "hard")[];
}) {
  const { section } = opts;
  const typeLabel = QUESTION_TYPE_LABELS[section.question_type] ?? section.question_type;
  const isHumanitiesSBQ =
    opts.subjectKind === "humanities" && section.question_type === "source_based";

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
    const labelList = labels.join(", ");
    const blocks = pool.map((src, i) => {
      const label = labels[i];
      return `  [Source ${label}] (use VERBATIM, do not modify):
  ---
  ${src.excerpt}
  ---
  Citation: Source: ${src.publisher} — ${src.source_url}`;
    }).join("\n\n");
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

SOURCE-BINDING RULES (CRITICAL):
  - Each sub-part is built on ONE specific source from Sources ${labelList} below — NOT a free choice.
  - The ONLY exceptions:
      • COMPARISON sub-parts may reference EXACTLY TWO sources (e.g. "Compare Sources A and B").
      • ASSERTION (hypothesis) sub-parts must use ALL ${labels.length} sources (Sources ${labelList}).
  - Every sub-part's stem MUST begin with an explicit instruction naming the source(s) it uses, e.g. "Study Source A.", "Study Sources A and B.", "Study Sources ${labelList}."
  - Across the section, DIFFERENT sub-parts should be anchored on DIFFERENT sources where possible (e.g. (a) → Source A, (b) → Source B, (c) → Source C, comparison → A & B, assertion → all). Do NOT bind two different sub-parts to the same single source.
  - DO NOT invent new sources. DO NOT paraphrase or modify the source text.
  - For EVERY part in this section, set source_excerpt to the FULL concatenated pool below (so the editor shows all sources to the student). Set source_url to Source A's URL.

SHARED SOURCES FOR THIS SECTION (Sources ${labelList}):
${blocks}

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

    skillBlock = `

SBQ SKILL ASSIGNMENTS (apply each skill's format and mark scheme to the assigned part):
${skillSummaries}

PER-PART SKILL & SOURCE-BINDING MAPPING (you MUST follow this exact mapping — DO NOT swap sources between parts):
${assignments}

IMPORTANT: For Assertion parts, the hypothesis MUST be testable against ALL sources (each should plausibly support OR challenge it). For single-source parts, the bound source is FIXED above — name it explicitly in the stem. Do NOT mix skill formats across parts. Do NOT bind two different single-source parts to the same source.`;
  }

  let difficultyBlock = "";
  if (opts.difficultyTargets && opts.difficultyTargets.length === section.num_questions) {
    const lines = opts.difficultyTargets
      .map((d, i) => `  - Question ${i + 1}: ${d.toUpperCase()}`)
      .join("\n");
    difficultyBlock = `

DIFFICULTY DISTRIBUTION (REQUIRED — set the difficulty field on each question to EXACTLY the target below):
${lines}

Calibrate stem complexity, distractor closeness (for MCQ), required reasoning steps and number of marks-bearing inferences to the target difficulty for each slot.`;
  }

  return `${grounding}You are drafting ${sectionLabel} of "${opts.title}" (${opts.level} ${opts.subject}, ${opts.assessmentType}, ${opts.durationMinutes} min, ${opts.totalMarks} total marks across ${opts.totalSections} sections).

THIS SECTION:
  - Question type for ALL questions in this section: ${typeLabel} — DO NOT mix in other types.
  - Number of questions: exactly ${section.num_questions}
  - Total marks for the section: ${section.marks}
  - ${marksGuide}
  - Bloom's level focus: ${section.bloom ?? "Apply"} (use other levels only if the topic clearly demands it)
  ${section.instructions ? `- Section instructions for the rubric: ${section.instructions}` : ""}
${skillBlock}${difficultyBlock}
${humanitiesSourceGuidance}${sbqSectionPreamble}
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
              answer: { type: "string", description: "The correct answer (for MCQ, the letter and option text)." },
              mark_scheme: { type: "string", description: "Marking rubric showing how to award marks." },
              source_excerpt: { type: ["string", "null"], description: "Verbatim source passage used in the stem (only when a GROUNDED SOURCE was provided)." },
              source_url: { type: ["string", "null"], description: "URL of the source (only when a GROUNDED SOURCE was provided)." },
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
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json?: any; errText?: string }> {
  const model = opts.model ?? "google/gemini-2.5-flash";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const aiBody = JSON.stringify({
    model,
    messages,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "save_assessment" } },
  });
  let aiResp: Response | null = null;
  let lastErrTxt = "";
  for (let attempt = 0; attempt < 2; attempt++) {
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
      if (attempt < 1) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      return { ok: false, status: 504, errText: lastErrTxt };
    }
    clearTimeout(t);
    if (aiResp.ok) break;
    lastErrTxt = await aiResp.text().catch(() => "");
    const transient = aiResp.status === 502 || aiResp.status === 503 || aiResp.status === 504 || aiResp.status === 429;
    console.warn(`[generate] AI attempt ${attempt + 1} failed status=${aiResp.status} transient=${transient}`);
    if (!transient) break;
    if (attempt < 1) await new Promise((r) => setTimeout(r, 1500));
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
  let statusClient: ReturnType<typeof createClient> | null = null;
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
    };

    const allRows: EnrichedRow[] = [];
    let droppedNoSource = 0;
    let groundedCount = 0;
    let diagramCount = 0;
    let sectionFailures = 0;
    // Track diagram URLs already used in this assessment to avoid repeating
    // the same figure across multiple questions.
    const usedDiagramUrls = new Set<string>();

    // Pick a topic pool entry, round-robining so all topics in the pool are covered.
    const pickTopic = (s: Section, qIdx: number): SectionTopic | null => {
      if (s.topic_pool.length === 0) return null;
      return s.topic_pool[qIdx % s.topic_pool.length];
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
      const sourcesForSection: (GroundedSource | null)[][] = [];

      if (isHumanitiesSBQ) {
        // Pool size = max minSources across selected skills, capped at 5, min 4
        // (so single-source skills like Inference still have room to choose A or B).
        const maxMinSources = effectiveSkillDefs.reduce((m, s) => Math.max(m, s.minSources), 0);
        const poolSize = Math.min(5, Math.max(4, maxMinSources));
        const sectionTopic = section.topic_pool[0] ?? null;
        // Vary the query angle for each of the 5 fetches so we get DIFFERENT
        // perspectives on the SAME inquiry question (rather than 5 near-duplicate
        // articles). Hints rotate through complementary angles a historian would
        // assemble for an SBQ pool.
        const POOL_QUERY_HINTS = [
          "official government statement",
          "newspaper report contemporary",
          "speech address transcript",
          "memoir eyewitness account",
          "historian scholarly analysis",
        ];
        if (sectionTopic) {
          for (let i = 0; i < poolSize; i++) {
            try {
              const src = await fetchGroundedSource(
                subjectKind, sectionTopic.topic, sectionTopic.learning_outcomes ?? [],
                usedHosts, usedUrls, POOL_QUERY_HINTS[i % POOL_QUERY_HINTS.length],
              );
              if (src) sharedSourcePool.push(src);
            } catch (e) {
              console.warn("[generate] shared source fetch failed for", sectionTopic.topic, e);
            }
          }
        }
        console.log(`[generate] section ${section.letter} SBQ pool: ${sharedSourcePool.length} sources (target ${poolSize})`);
        // Every question slot references the SAME shared pool.
        for (let qi = 0; qi < section.num_questions; qi++) {
          sourcesForSection.push(sharedSourcePool.slice());
        }
      } else if (needsSourcePerQ && subjectKind) {
        // Non-SBQ humanities or English comprehension: per-question source.
        for (let qi = 0; qi < section.num_questions; qi++) {
          const t = pickTopic(section, qi);
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
        let chunkFailed = false;

        for (let c = 0; c < numChunks; c++) {
          const startIdx = c * CHUNK_SIZE;
          const endIdx = Math.min(totalQs, startIdx + CHUNK_SIZE);
          const chunkQCount = endIdx - startIdx;

          // Build a per-chunk shallow copy of the section with its slice of
          // questions and the proportional marks for that slice.
          const chunkMarks = Math.max(
            chunkQCount,
            Math.round((section.marks * chunkQCount) / totalQs),
          );
          const chunkSection: Section = {
            ...section,
            num_questions: chunkQCount,
            marks: chunkMarks,
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
              content: `This section has ${totalQs} questions total; you are generating questions ${startIdx + 1}–${endIdx} (batch ${c + 1} of ${numChunks}). Generate EXACTLY ${chunkQCount} questions and do not duplicate topics already used in earlier batches.`,
            });
          }
          messages.push({
            role: "user",
            content: buildSectionUserPrompt({
              title, subject, level, assessmentType, totalMarks, durationMinutes,
              section: chunkSection, sectionIndex: si, totalSections: sections.length,
              syllabusCode, paperCode, groundedSources: chunkSources,
              sharedSourcePool: isHumanitiesSBQ ? sharedSourcePool : undefined,
              subjectKind, instructions,
            }),
          });

          const ai = await callAI(messages);
          if (!ai.ok) {
            console.error(`[generate] section ${section.letter} chunk ${c + 1}/${numChunks} AI error`, ai.status, (ai.errText ?? "").slice(0, 300));
            chunkFailed = true;
            break;
          }
          const toolCall = ai.json?.choices?.[0]?.message?.tool_calls?.[0];
          if (!toolCall) {
            console.error(`[generate] section ${section.letter} chunk ${c + 1}/${numChunks}: no tool call`, JSON.stringify(ai.json).slice(0, 300));
            chunkFailed = true;
            break;
          }
          let parsed: { questions?: any[] };
          try { parsed = JSON.parse(toolCall.function.arguments); }
          catch {
            chunkFailed = true;
            break;
          }
          const chunkQs = parsed.questions ?? [];
          questions.push(...chunkQs);
          console.log(`[generate] section ${section.letter} chunk ${c + 1}/${numChunks}: produced ${chunkQs.length} questions (cumulative ${questions.length}/${totalQs})`);
        }

        if (chunkFailed && questions.length === 0) {
          sectionFailures++;
          continue;
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
          source_excerpt = sharedSourcePool
            .map((s, i) => `Source ${String.fromCharCode(65 + i)}: ${s.excerpt}`)
            .join("\n\n");
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
        const t = pickTopic(section, qi);
        const wantDiagram = !!scienceMathKind && questionWantsDiagram(
          scienceMathKind,
          [question_type],
          q.topic ?? t?.topic ?? "",
          t?.learning_outcomes ?? [],
          q.stem ?? "",
        );

        allRows.push({
          assessment_id: assessmentId,
          user_id: userId,
          position: allRows.length,
          question_type,
          topic: q.topic ?? null,
          bloom_level: q.bloom_level ?? section.bloom ?? null,
          difficulty: q.difficulty ?? null,
          marks: q.marks ?? 1,
          stem: q.stem,
          options: q.options ?? null,
          answer: q.answer ?? null,
          mark_scheme: q.mark_scheme ?? null,
          source_excerpt,
          source_url,
          notes,
          diagram_url: null,
          diagram_source: null,
          diagram_citation: null,
          diagram_caption: null,
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
        const CONCURRENCY = 8;
        let cursor = 0;
        const runOne = async () => {
          while (cursor < diagramTasks.length) {
            const myIdx = cursor++;
            const { r, idx } = diagramTasks[myIdx];
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
                // 40+ MCQs running 8-wide.
                pastPapersTimeoutMs: 4000,
                webTimeoutMs: 8000,
                aiTimeoutMs: 14000,
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
        await Promise.all(workers);
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
