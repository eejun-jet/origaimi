// Pre-generation Assessment Intent Coach — deterministic, client-side checks.
//
// Philosophy: silence is better than low-value commentary. Each helper returns
// a (possibly empty) list of short, dismissible nudges. The UI shows at most
// 1–2 at a time. No AI is called here — see `coach-intent` edge function for
// the AI-backed pass.

import type { Section } from "./sections";
import type { AssessmentObjective } from "./syllabus-data";
import { bucketOf, bucketTargets, rollupCounts } from "./ao-rollup";

export type IntentSignal = {
  id: string; // stable id so the user can dismiss it
  severity: "info" | "warn";
  category:
    | "intent"
    | "ao_balance"
    | "cognitive_demand"
    | "coverage"
    | "context"
    | "instructions"
    | "pitch"
    | "style";
  note: string; // one-liner, plain teacher language
  // Optional one-line text the panel can append to Special Instructions.
  applyToInstructions?: string;
};

export type BuilderSnapshot = {
  step: 2 | 3 | 4;
  subject: string | null;
  level: string | null;
  syllabusCode?: string | null;
  syllabusDocId?: string | null;
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

// Mark-weighted AO frequency, rolled up to letter-prefix buckets.
// AO targets in the syllabus are mark-based, so we weight each section by
// its `marks` (falling back to `num_questions` when marks is 0). Granular
// codes (A1, A2, …, B1, …) are collapsed into their bucket (A, B, …).
const aoFrequency = (sections: Section[]) => {
  const counts = new Map<string, number>();
  for (const s of sections) {
    const codes = s.ao_codes ?? [];
    if (codes.length === 0) continue;
    const weight = (s.marks && s.marks > 0) ? s.marks : (s.num_questions || 1);
    const per = weight / codes.length;
    for (const code of codes) {
      const b = bucketOf(code);
      counts.set(b, (counts.get(b) ?? 0) + per);
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

  // 2) AO balance — compare planned AO mix against syllabus weighting targets
  // when those targets are present; otherwise fall back to a simple "one AO
  // dominates" check.
  const aoCounts = aoFrequency(sections);
  if (step >= 2 && aoCounts.size > 0) {
    const total = Array.from(aoCounts.values()).reduce((a, b) => a + b, 0);
    const targets = new Map<string, number>();
    for (const a of snap.paperAOs) {
      if (typeof a.weightingPercent === "number" && a.weightingPercent > 0) {
        targets.set(a.code, a.weightingPercent);
      }
    }

    if (total > 0 && targets.size > 0) {
      // Compare planned vs target. Flag the worst offender if delta ≥ 20pp.
      let worstCode: string | null = null;
      let worstDelta = 0;
      for (const [code, target] of targets) {
        const planned = ((aoCounts.get(code) ?? 0) / total) * 100;
        const delta = planned - target;
        if (Math.abs(delta) > Math.abs(worstDelta)) {
          worstDelta = delta;
          worstCode = code;
        }
      }
      if (worstCode && Math.abs(worstDelta) >= 20) {
        const ao = snap.paperAOs.find((a) => a.code === worstCode);
        const label = ao?.title ? `${worstCode} (${ao.title})` : worstCode;
        const target = targets.get(worstCode)!;
        const planned = ((aoCounts.get(worstCode) ?? 0) / total) * 100;
        const direction = worstDelta > 0 ? "higher" : "lower";
        out.push({
          id: `ao-target-${worstCode}`,
          severity: "warn",
          category: "ao_balance",
          note:
            `Plan is ~${Math.round(planned)}% ${label} vs syllabus target ~${Math.round(target)}% — ${direction} than expected. Consider rebalancing one section.`,
        });
      }
    } else {
      // No target weightings — fall back to "one AO dominates".
      const sorted = Array.from(aoCounts.entries()).sort((a, b) => b[1] - a[1]);
      const [topCode, topCount] = sorted[0];
      if (total > 0 && topCount / total >= 0.8) {
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

  // 3b) Multi-discipline imbalance — for Combined Science / multi-track papers,
  // flag a discipline that has 0 marks while others dominate.
  if (step >= 2 && sections.length > 0) {
    const disciplineMarks = new Map<string, number>();
    const allDisciplines = new Set<string>();
    for (const s of sections) {
      for (const t of s.topic_pool ?? []) {
        if (t.section) allDisciplines.add(t.section);
      }
    }
    if (allDisciplines.size >= 2) {
      for (const d of allDisciplines) disciplineMarks.set(d, 0);
      for (const s of sections) {
        const sectionDisc = new Set<string>();
        for (const t of s.topic_pool ?? []) if (t.section) sectionDisc.add(t.section);
        if (sectionDisc.size > 0) {
          const share = s.marks / sectionDisc.size;
          for (const d of sectionDisc) disciplineMarks.set(d, (disciplineMarks.get(d) ?? 0) + share);
        }
      }
      const empty = Array.from(disciplineMarks.entries()).filter(([, m]) => m === 0).map(([d]) => d);
      if (empty.length > 0 && empty.length < allDisciplines.size) {
        out.push({
          id: `discipline-empty-${empty.join("-")}`,
          severity: "warn",
          category: "coverage",
          note: `No marks allocated to ${empty.join(", ")} — intentional, or worth balancing across disciplines?`,
        });
      }
    }
  }

  // 3c) Cognitive plateau — Bloom levels across sections are all "remember/understand".
  if (step >= 2 && sections.length >= 2) {
    const blooms = sections.map((s) => (s.bloom ?? "").toLowerCase()).filter(Boolean);
    const lowOnly = blooms.length > 0 && blooms.every((b) => /remember|understand|recall|knowledge/.test(b));
    if (lowOnly) {
      out.push({
        id: "bloom-plateau",
        severity: "warn",
        category: "cognitive_demand",
        note: "Every section sits at recall/understanding. One section pitched at 'apply' or 'evaluate' would lift demand.",
      });
    }
  }

  // 3d) Pitch hint — average marks-per-question very low for the level.
  if (step >= 2 && sections.length > 0) {
    const totalQ = sections.reduce((a, s) => a + (s.num_questions || 0), 0);
    const totalM = sections.reduce((a, s) => a + (s.marks || 0), 0);
    const level = (snap.level ?? "").toLowerCase();
    const isUpperSec = /o[\s-]?level|n\(a\)|n\(t\)|secondary 3|secondary 4/.test(level);
    if (totalQ >= 5 && totalM > 0 && isUpperSec && totalM / totalQ < 1.5) {
      out.push({
        id: "pitch-too-light",
        severity: "info",
        category: "pitch",
        note: "Average is under 1.5 marks per question — pitches lighter than typical at this level. Consider a structured/extended item.",
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

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot summaries — fuel the "Alignment" and "Style" panels in the UI.
// ─────────────────────────────────────────────────────────────────────────────

export type AlignmentRow = {
  code: string;
  title?: string | null;
  targetPercent: number | null;
  plannedPercent: number;
};

export function computeAlignmentSummary(snap: BuilderSnapshot): AlignmentRow[] {
  const counts = aoFrequency(snap.sections);
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const codes = new Set<string>([
    ...snap.paperAOs.map((a) => a.code),
    ...counts.keys(),
  ]);
  const rows: AlignmentRow[] = [];
  for (const code of codes) {
    const ao = snap.paperAOs.find((a) => a.code === code);
    rows.push({
      code,
      title: ao?.title ?? null,
      targetPercent: typeof ao?.weightingPercent === "number" ? ao.weightingPercent : null,
      plannedPercent: total > 0 ? Math.round(((counts.get(code) ?? 0) / total) * 100) : 0,
    });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export type StyleSummary = {
  formatMix: { type: string; count: number }[];
  bloomMix: { level: string; count: number }[];
  totalQuestions: number;
  uniqueFormats: number;
  uniqueBlooms: number;
};

export function computeStyleSummary(snap: BuilderSnapshot): StyleSummary {
  const formats = new Map<string, number>();
  const blooms = new Map<string, number>();
  let totalQ = 0;
  for (const s of snap.sections) {
    const n = s.num_questions || 0;
    totalQ += n;
    formats.set(s.question_type, (formats.get(s.question_type) ?? 0) + n);
    if (s.bloom) blooms.set(s.bloom, (blooms.get(s.bloom) ?? 0) + n);
  }
  return {
    formatMix: Array.from(formats.entries()).map(([type, count]) => ({ type, count })),
    bloomMix: Array.from(blooms.entries()).map(([level, count]) => ({ level, count })),
    totalQuestions: totalQ,
    uniqueFormats: formats.size,
    uniqueBlooms: blooms.size,
  };
}

// Convenience for the AI-backed call: build a compact, JSON-safe payload.
export function snapshotForAI(snap: BuilderSnapshot) {
  return {
    subject: snap.subject,
    level: snap.level,
    syllabus_code: snap.syllabusCode ?? null,
    syllabus_doc_id: snap.syllabusDocId ?? null,
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
