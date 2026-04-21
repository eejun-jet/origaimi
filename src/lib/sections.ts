// Section-based blueprint shape used by the assessment builder + generator.
// Each Section has its own question type, topic pool, marks and question count.
// Old flat blueprints (an array of {topic, bloom, marks}) are migrated to a
// single virtual section on read so existing assessments keep working.

export const SBQ_SKILLS = [
  { id: "inference", label: "Inference", marks: [5, 6, 7, 8], default: 6, locked: false },
  { id: "purpose", label: "Purpose", marks: [5, 6, 7, 8], default: 6, locked: false },
  { id: "comparison", label: "Comparison", marks: [5, 6, 7, 8], default: 6, locked: false },
  { id: "utility", label: "Utility", marks: [6, 7, 8], default: 7, locked: false },
  { id: "reliability", label: "Reliability", marks: [6, 7, 8], default: 7, locked: false },
  { id: "surprise", label: "Surprise", marks: [5, 6, 7, 8], default: 6, locked: false },
  { id: "assertion", label: "Assertion (Hypothesis)", marks: [8], default: 8, locked: true },
] as const;

export type SbqSkill = typeof SBQ_SKILLS[number]["id"];

export function getSbqSkill(id: string | undefined | null) {
  if (!id) return null;
  return SBQ_SKILLS.find((s) => s.id === id) ?? null;
}

export function isHumanitiesSubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return s.includes("history") || s.includes("social studies") || s.includes("humanities");
}

export type SectionTopic = {
  topic: string;
  topic_code?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
};

export type Section = {
  id: string;            // stable client id for keys
  letter: string;        // "A", "B", "C"
  name?: string;         // e.g. "Source-Based Question"
  question_type: string; // matches QUESTION_TYPES ids in src/lib/syllabus.ts
  marks: number;         // total marks for this section
  num_questions: number; // how many questions to generate in this section
  bloom?: string;        // primary Bloom's level for the section
  topic_pool: SectionTopic[];
  instructions?: string;
};

export type SectionedBlueprint = { sections: Section[] };

// Legacy flat blueprint (still in older `assessments.blueprint` rows).
export type LegacyBlueprintRow = {
  topic: string;
  bloom?: string;
  marks: number;
  topic_code?: string | null;
  section?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
};

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function nextSectionLetter(existing: Section[]): string {
  for (const l of LETTERS) {
    if (!existing.some((s) => s.letter === l)) return l;
  }
  return String(existing.length + 1);
}

export function makeSectionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultSection(letter: string, totalMarksRemaining: number): Section {
  return {
    id: makeSectionId(),
    letter,
    name: "",
    question_type: "structured",
    marks: Math.max(1, totalMarksRemaining),
    num_questions: 1,
    bloom: "Apply",
    topic_pool: [],
    instructions: "Answer all questions in this section.",
  };
}

/** Detect both the new sectioned shape and the legacy flat shape. */
export function isSectionedBlueprint(bp: unknown): bp is SectionedBlueprint {
  return (
    !!bp &&
    typeof bp === "object" &&
    !Array.isArray(bp) &&
    Array.isArray((bp as SectionedBlueprint).sections)
  );
}

/** Migrate either shape into a SectionedBlueprint for downstream consumers. */
export function toSectioned(
  bp: unknown,
  fallbackQuestionType: string = "structured",
): SectionedBlueprint {
  if (isSectionedBlueprint(bp)) return bp;
  if (Array.isArray(bp)) {
    const rows = bp as LegacyBlueprintRow[];
    if (rows.length === 0) return { sections: [] };
    // Group by `section` field if present; otherwise everything goes into Section A.
    const groups = new Map<string, LegacyBlueprintRow[]>();
    for (const r of rows) {
      const key = (r.section ?? "").trim() || "__default";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const sections: Section[] = [];
    let i = 0;
    for (const [, rs] of groups) {
      const marks = rs.reduce((acc, r) => acc + (r.marks || 0), 0);
      sections.push({
        id: makeSectionId(),
        letter: LETTERS[i] ?? String(i + 1),
        question_type: fallbackQuestionType,
        marks,
        num_questions: rs.length,
        bloom: rs[0]?.bloom ?? "Apply",
        topic_pool: rs.map((r) => ({
          topic: r.topic,
          topic_code: r.topic_code ?? null,
          learning_outcomes: r.learning_outcomes,
          ao_codes: r.ao_codes,
          outcome_categories: r.outcome_categories,
        })),
        instructions: "",
      });
      i++;
    }
    return { sections };
  }
  return { sections: [] };
}

export function blueprintTotalMarks(bp: SectionedBlueprint): number {
  return bp.sections.reduce((acc, s) => acc + (s.marks || 0), 0);
}

/** Cumulative question counts so the editor can compute "this question is in
 *  Section B" from its position in the flat assessment_questions list. */
export function sectionAtPosition(
  bp: SectionedBlueprint,
  position: number,
): Section | null {
  let cursor = 0;
  for (const s of bp.sections) {
    const next = cursor + (s.num_questions || 0);
    if (position >= cursor && position < next) return s;
    cursor = next;
  }
  return null;
}
