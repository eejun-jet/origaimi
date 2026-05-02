// Difficulty rubric for Singapore MOE-style assessment items.
//
// The goal of this module is to make `easy / medium / hard` an *observable*
// lever, not a label. The rubric below lists concrete, calibratable criteria
// the model can act on; `buildDifficultyDirective` returns a prompt block
// that pairs the rubric with a comparative checklist so a regenerated item
// is visibly different from the original.

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTY_RUBRIC: Record<Difficulty, string> = {
  easy: `EASY (recall / direct application — typically Bloom Remember / Understand, sometimes low Apply)
  • Single reasoning step. The candidate either recalls a fact or applies a familiar formula / definition once.
  • Familiar Singapore-textbook context — no novel scenario, no transfer.
  • One piece of given data; no extraction from a table / graph / passage beyond reading off a value.
  • Stem is one short sentence (≤25 words). No qualifying clauses, no nested conditions.
  • Vocabulary at the level baseline; no domain jargon beyond what the syllabus mandates.
  • For MCQ: distractors are plainly wrong on inspection (e.g. wrong unit, wrong sign, wrong concept). Only one option is even superficially defensible.
  • For structured / SBQ: each sub-part is independently scorable; no chaining required.`,

  medium: `MEDIUM (typical mid-paper item — Bloom Apply / low Analyse)
  • Two reasoning steps OR one transfer step into a familiar variant context.
  • Mild data-extraction load: read one value from a table / graph / passage, then operate on it.
  • Stem may carry one qualifying clause ("given that…", "assuming…", "for the case where…").
  • For MCQ: at least ONE distractor encodes a common misconception that is "almost right" if the candidate skips a step or misreads a sign / unit. Other distractors are plausible but secondary.
  • For structured / SBQ: at least one sub-part depends on an earlier sub-part's reasoning (light chaining). Candidate must select the relevant principle, not be told which to use.
  • Numerical answers require attention to units and to 2–3 significant figures.`,

  hard: `HARD (discriminator item — Bloom Analyse / Evaluate / Create)
  • Three or more reasoning steps OR transfer into an UNFAMILIAR but realistic context the candidate has not seen drilled.
  • Multi-piece data-extraction or multi-source synthesis (combine a graph + a passage; combine two sources; combine a formula with a constraint).
  • Stem carries 1–2 constraints or qualifiers the candidate MUST notice ("without using a calculator", "in terms of X only", "assuming Y is negligible", "evaluate the extent to which…"). Missing the constraint loses ≥half the marks.
  • The candidate must SELECT the principle/approach themselves; the stem does not name it.
  • For MCQ: every distractor encodes a NAMED misconception or a specific common error (sign flip, off-by-one, wrong frame of reference, misapplied formula). At least two distractors are defensible without careful work.
  • For structured: requires non-obvious rearrangement / unit conversion / sig-fig discipline / dimensional check; later sub-parts depend explicitly on earlier ones.
  • For source-based: requires explicit weighing of provenance against content, cross-referencing across sources, and a substantiated overall judgement — not a list of points.
  • Quantitatively: a competent but rushed candidate would lose ≥30% of the marks. The item discriminates between Band 1 and Band 2 candidates.`,
};

/**
 * Prompt block for the GENERATOR (used per-question slot inside a section).
 * Lists the rubric for ONE level only, so the generator gets surgical guidance
 * for each slot without bloating the prompt for the whole section.
 */
export function buildDifficultyRubricBlock(targets: readonly Difficulty[]): string {
  const unique = Array.from(new Set(targets));
  if (unique.length === 0) return "";
  const blocks = unique.map((d) => DIFFICULTY_RUBRIC[d]).join("\n\n");
  return `

DIFFICULTY RUBRIC (apply STRICTLY when calibrating each question to its assigned target):

${blocks}`;
}

/**
 * Prompt block for the REGENERATOR (one question, one target).
 * Pairs the rubric with a comparative checklist so the rewrite is observably
 * different from the original — the most common failure mode is "same item,
 * relabelled".
 */
export function buildRegenerateDifficultyDirective(
  target: Difficulty,
  originalDifficulty: string | null,
  questionType: string,
): string {
  const rubric = DIFFICULTY_RUBRIC[target];
  const wasSame = (originalDifficulty ?? "").toLowerCase() === target;

  // Direction-of-change checklist. Each item is a concrete edit the model can
  // make (or remove) to push the item in the requested direction.
  const upChecklist = [
    "Add at least one extra reasoning step that the candidate must perform before reaching the answer.",
    "Move the context to a less familiar but realistic Singapore scenario the candidate has NOT been drilled on.",
    "Add a constraint or qualifying clause the candidate MUST notice (e.g. \"without a calculator\", \"in terms of X only\", \"assuming Y is negligible\").",
    questionType === "mcq"
      ? "Rewrite ALL distractors so each encodes a specific named misconception or common error; at least two should be defensible without careful work."
      : "Make the candidate SELECT the principle/approach themselves — do not name it in the stem.",
    "Increase the data-extraction or synthesis load (e.g. combine a graph with a passage, or two sources).",
    "Require non-obvious rearrangement, unit conversion, or sig-fig discipline before the answer is reachable.",
  ];
  const downChecklist = [
    "Reduce to a single reasoning step; remove any chaining between sub-parts.",
    "Move the context back to a familiar Singapore-textbook scenario.",
    "Remove qualifying clauses; the stem should be one short sentence.",
    questionType === "mcq"
      ? "Make distractors plainly wrong on inspection (wrong unit, wrong sign, wrong concept). Only one option should be even superficially defensible."
      : "Name the principle or formula in the stem so the candidate does not have to select it.",
    "Reduce the data load to a single given value; no extraction from a table or passage.",
    "Drop any constraints, multi-source synthesis, or non-obvious rearrangement.",
  ];

  const direction =
    target === "easy" ? "EASIER" : target === "hard" ? "HARDER" : "RECALIBRATED to medium";
  const checklist = target === "easy" ? downChecklist : target === "hard" ? upChecklist : [
    "Trim to two reasoning steps — neither trivial recall nor multi-step synthesis.",
    "Use a familiar variant context (not the textbook example, but not novel).",
    "Add ONE qualifying clause; remove any extra constraints beyond that.",
    questionType === "mcq"
      ? "Ensure at least ONE distractor encodes a common misconception; the rest plausible but secondary."
      : "Allow light chaining between sub-parts; the candidate should select the principle but the path should be inferable.",
  ];

  return `

TARGET DIFFICULTY: ${target.toUpperCase()} (original was ${originalDifficulty ?? "unknown"}).

${rubric}

COMPARATIVE REWRITE CHECKLIST — the rewritten stem MUST be observably ${direction} than the original. ${
    wasSame
      ? "The original was already tagged at this level but felt off-target — apply the rubric strictly and tighten."
      : "Apply at least THREE of the following edits (more is better):"
  }
${checklist.map((c) => `  • ${c}`).join("\n")}

The "difficulty" field returned by the tool MUST be exactly "${target}". Do NOT just relabel the original — the stem itself must change in the directions above.`;
}
