// Pre-generation Assessment Intent Coach — deterministic, client-side checks.
//
// Philosophy: silence is better than low-value commentary. Each helper returns
// a (possibly empty) list of short, dismissible nudges. The UI shows at most
// 1–2 at a time. No AI is called here — see `coach-intent` edge function for
// the AI-backed pass.

import type { Section } from "./sections";
import type { AssessmentObjective } from "./syllabus-data";

export type IntentSignal = {
  id: string; // stable id so the user can dismiss it
  severity: "info" | "warn";
  category: "intent" | "ao_balance" | "cognitive_demand" | "coverage" | "context" | "instructions";
  note: string; // one-liner, plain teacher language
  // Optional one-line text the panel can append to Special Instructions.
  applyToInstructions?: string;
};

export type BuilderSnapshot = {
  step: 2 | 3 | 4;
  subject: string | null;
  level: string | null;
  syllabusCode?: string | null;
  paperCode?: string | null;
  assessmentMode?: string | null; // "written" | "spoken" | "listening" | …
  totalMarks: number;
  duration: number;
  sections: Section[];
  referenceNote: string;
  paperAOs: AssessmentObjective[]; // syllabus AO definitions
  selectedAoCodes: string[];
  selectedKos: string[];
  selectedLos: string[];
  topicPoolSize: number; // size of the global topic pool selected on the previous step
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const isMcqOnly = (sections: Section[]) =>
  sections.length > 0 && sections.every((s) => s.question_type === "mcq");

const allOneType = (sections: Section[]) => {
  if (sections.length < 2) return false;
  const t = sections[0].question_type;
  return sections.every((s) => s.question_type === t);
};

const aoFrequency = (sections: Section[]) => {
  const counts = new Map<string, number>();
  for (const s of sections) {
    for (const code of s.ao_codes ?? []) {
      counts.set(code, (counts.get(code) ?? 0) + (s.num_questions || 1));
    }
  }
  return counts;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public: compute deterministic signals for the current builder state.
// ─────────────────────────────────────────────────────────────────────────────

export function computeIntentSignals(snap: BuilderSnapshot): IntentSignal[] {
  const out: IntentSignal[] = [];
  const { sections, step } = snap;

  // Nothing to coach until at least one section exists.
  if (step >= 2 && sections.length === 0) return out;

  // 1) Cognitive diversity — only one question type across multiple sections.
  // Skip MCQ-only papers when the syllabus paper is explicitly an MCQ paper
  // (the picker auto-fills paperCode like "P1" — we don't have a clean signal
  // for "MCQ-only paper", so we soften the wording rather than suppress).
  if (step >= 2 && allOneType(sections) && sections.length >= 2) {
    if (isMcqOnly(sections)) {
      out.push({
        id: "all-mcq",
        severity: "info",
        category: "cognitive_demand",
        note:
          "Every section is MCQ. If this is a Paper 1 by design, ignore — otherwise one short open-response item would add reasoning depth.",
      });
    } else {
      out.push({
        id: "single-type",
        severity: "info",
        category: "cognitive_demand",
        note: "All sections share one question type. Mixing in another format usually broadens what you can assess.",
      });
    }
  }

  // 2) AO balance — heavy concentration on a single AO (when AOs are tagged).
  const aoCounts = aoFrequency(sections);
  if (step >= 2 && aoCounts.size > 0) {
    const total = Array.from(aoCounts.values()).reduce((a, b) => a + b, 0);
    const sorted = Array.from(aoCounts.entries()).sort((a, b) => b[1] - a[1]);
    const [topCode, topCount] = sorted[0];
    if (total > 0 && topCount / total >= 0.8 && aoCounts.size >= 1) {
      const ao = snap.paperAOs.find((a) => a.code === topCode);
      const label = ao?.title ? `${topCode} (${ao.title})` : topCode;
      const isAo1 = topCode.toUpperCase() === "AO1";
      out.push({
        id: `ao-heavy-${topCode}`,
        severity: "warn",
        category: "ao_balance",
        note: isAo1
          ? `Heavy on recall — ${label} dominates. Consider one application or reasoning item.`
          : `One AO dominates — ${label}. A second AO would broaden the demand.`,
      });
    }
  }

  // 3) Coverage — many topics selected, few sections cover them.
  if (step >= 2 && snap.topicPoolSize >= 3) {
    const coveredTopicTitles = new Set<string>();
    for (const s of sections) {
      for (const t of s.topic_pool ?? []) coveredTopicTitles.add(t.topic);
    }
    if (coveredTopicTitles.size > 0 && coveredTopicTitles.size <= Math.max(1, Math.floor(snap.topicPoolSize / 3))) {
      out.push({
        id: "narrow-topic-coverage",
        severity: "info",
        category: "coverage",
        note: `${snap.topicPoolSize} topics selected, only ${coveredTopicTitles.size} are exercised. Intentional, or worth widening?`,
      });
    }
  }

  // 4) Special-instructions opportunity — empty note on Step 3+ for a paper
  // type where one good cue meaningfully changes the draft.
  if (step >= 3 && snap.referenceNote.trim().length === 0) {
    const subj = (snap.subject ?? "").toLowerCase();
    if (/(history|social studies|geograph|humanit)/.test(subj)) {
      out.push({
        id: "humanities-context-cue",
        severity: "info",
        category: "context",
        note: "No special instructions yet. A short Singapore context cue (e.g. an HDB or hawker scenario) often improves authenticity.",
        applyToInstructions: "Use Singapore-relevant contexts (e.g. HDB estates, hawker centres, MRT) where natural.",
      });
    } else if (/(science|physics|chemistry|biology)/.test(subj)) {
      out.push({
        id: "science-units-cue",
        severity: "info",
        category: "context",
        note: "No special instructions yet. A line on units, sig figs, or a familiar SG context can lift quality at no cost.",
        applyToInstructions: "Use SI units. Quote numerical answers to 2–3 significant figures. Prefer Singapore-relevant contexts.",
      });
    } else if (/(math|english)/.test(subj)) {
      out.push({
        id: "transfer-cue",
        severity: "info",
        category: "context",
        note: "No special instructions yet. Adding one unfamiliar context tends to test transfer rather than recall.",
        applyToInstructions: "Include at least one item set in an unfamiliar but realistic context to assess transfer.",
      });
    }
  }

  // 5) Marks mismatch — only flagged silently (the builder already shows a red
  // total). Coach stays out of the way here.

  return out;
}

// Convenience for the AI-backed call: build a compact, JSON-safe payload.
export function snapshotForAI(snap: BuilderSnapshot) {
  return {
    subject: snap.subject,
    level: snap.level,
    syllabus_code: snap.syllabusCode ?? null,
    paper_code: snap.paperCode ?? null,
    assessment_mode: snap.assessmentMode ?? "written",
    total_marks: snap.totalMarks,
    duration_min: snap.duration,
    special_instructions: snap.referenceNote ?? "",
    selected_ao_codes: snap.selectedAoCodes,
    selected_knowledge_outcomes: snap.selectedKos,
    selected_learning_outcomes: snap.selectedLos,
    paper_ao_definitions: snap.paperAOs.map((a) => ({
      code: a.code,
      title: a.title ?? null,
      weighting_percent: a.weightingPercent ?? null,
    })),
    sections: snap.sections.map((s) => ({
      letter: s.letter,
      name: s.name ?? null,
      question_type: s.question_type,
      num_questions: s.num_questions,
      marks: s.marks,
      bloom: s.bloom ?? null,
      ao_codes: s.ao_codes ?? [],
      knowledge_outcomes: s.knowledge_outcomes ?? [],
      learning_outcomes: s.learning_outcomes ?? [],
      topic_pool: (s.topic_pool ?? []).map((t) => t.topic),
      instructions: s.instructions ?? null,
    })),
  };
}
