// Export the Table of Specifications (TOS) for an assessment as an .xlsx
// workbook with three sheets: paper summary, AO/KO/LO matrix, and a
// per-question map. Pure client-side — uses SheetJS (xlsx) which is already
// installed in the project.

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { normaliseDiscipline } from "./discipline-scope";

export type TosAssessmentMeta = {
  title: string;
  subject: string;
  level: string;
  syllabus_code: string | null;
  /** Paper number rendered as its own row in the summary, separate from the
   *  syllabus code (e.g. syllabus 5086/5087/5088 with paper "1"). */
  paper_number?: string | null;
  duration_minutes: number;
  total_marks: number;
  total_actual: number;
  assessment_type: string;
  instructions: string | null;
  // True when teacher has reviewed and saved AO targets for an imported
  // past paper (Coverage panel "Confirm AO blueprint targets" step).
  ao_targets_confirmed?: boolean;
};

export type TosSection = {
  id: string;
  letter: string;
  name: string | null;
  question_type: string;
  num_questions: number;
  marks: number;
};

export type TosCoverage = {
  paper: {
    aos: { code: string; title: string | null; target: number; actual: number; weighting: number | null }[];
    kos: { name: string; target: number; actual: number }[];
    los: { text: string; target: number; actual: number; covered: boolean }[];
    sectionMarks: { letter: string; target: number; actual: number }[];
  };
  bySection: Record<string, {
    letter: string;
    name: string;
    marks: { target: number; actual: number };
    aos: { code: string; title: string | null; actual: number }[];
    kos: { name: string; actual: number }[];
    los: { text: string; actual: number; covered: boolean }[];
  }>;
};

export type TosQuestion = {
  position: number;
  question_type: string;
  topic: string | null;
  bloom_level: string | null;
  difficulty: string | null;
  marks: number;
  stem: string;
  ao_codes: string[];
  knowledge_outcomes: string[];
  learning_outcomes: string[];
};

/** One row per syllabus topic, used to map LOs ⇄ KOs ⇄ discipline so the
 *  TOS can render a condensed "KO → LO" coverage table. */
export type TosTopicIndexEntry = {
  learning_outcomes: string[];
  outcome_categories: string[];
  section: string | null;
  /** Used as a KO fallback when outcome_categories is empty (e.g. Combined
   *  Science syllabus topics carry no KO labels — the syllabus instead
   *  groups LOs under strands like "Kinematics" or "Acids, Bases and Salts"). */
  strand?: string | null;
  sub_strand?: string | null;
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "assessment";
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function aoOf(q: TosQuestion): string[] { return q.ao_codes ?? []; }
function koOf(q: TosQuestion): string[] { return q.knowledge_outcomes ?? []; }
function loOf(q: TosQuestion): string[] { return q.learning_outcomes ?? []; }

function sectionLetterForPosition(sections: TosSection[], position: number): string {
  let cursor = 0;
  for (const s of sections) {
    if (position < cursor + (s.num_questions || 0)) return s.letter;
    cursor += s.num_questions || 0;
  }
  return sections[sections.length - 1]?.letter ?? "";
}

// ── KO → LO grouping ───────────────────────────────────────────────────────

const DISCIPLINE_ORDER = ["Physics", "Chemistry", "Biology", "Practical", "Other"];

export type KoLoGrouping = {
  /** Disciplines actually present (in display order). One column per entry. */
  disciplines: string[];
  /** Per-KO row data — `lines[discipline]` is a multi-line string of LOs,
   *  each prefixed with ✓ when covered and · otherwise. */
  rows: {
    name: string;
    target: number;
    actual: number;
    delta: number;
    /** "X / Y" — covered LOs out of total LOs in this KO (across all disciplines). */
    loCoverage: string;
    cells: Record<string, string>;
  }[];
};

export function buildKoLoGrouping(
  coverage: TosCoverage,
  topicIndex: TosTopicIndexEntry[],
): KoLoGrouping {
  // LO → covered? lookup from coverage.
  const coveredByLo = new Map<string, boolean>();
  for (const lo of coverage.paper.los) coveredByLo.set(lo.text, lo.covered);

  // Decide a KO label for a given topic:
  //   1) any explicit `outcome_categories` entry, else
  //   2) the strand (Combined Science, IP, etc. typically rely on strands).
  const koLabelsFor = (t: TosTopicIndexEntry): string[] => {
    const explicit = (t.outcome_categories ?? []).filter((x) => (x ?? "").trim());
    if (explicit.length > 0) return explicit;
    const strand = (t.strand ?? "").trim();
    if (strand) return [strand];
    return [];
  };

  // Build (KO → discipline → ordered LOs) from the topic index, preserving
  // first-seen order for both KOs and LOs.
  const koOrder: string[] = [];
  const koMap = new Map<string, Map<string, string[]>>();
  const seen = new Map<string, Set<string>>(); // ko → loSet (dedupe per disc::lo)
  const presentDisciplines = new Set<string>();

  for (const t of topicIndex) {
    const disc = normaliseDiscipline(t.section ?? null);
    presentDisciplines.add(disc);
    const kos = koLabelsFor(t);
    const los = (t.learning_outcomes ?? []).filter(Boolean);
    if (kos.length === 0 || los.length === 0) continue;
    for (const ko of kos) {
      if (!koMap.has(ko)) {
        koMap.set(ko, new Map());
        seen.set(ko, new Set());
        koOrder.push(ko);
      }
      const dMap = koMap.get(ko)!;
      const loSet = seen.get(ko)!;
      if (!dMap.has(disc)) dMap.set(disc, []);
      const arr = dMap.get(disc)!;
      for (const lo of los) {
        const key = `${disc}::${lo}`;
        if (loSet.has(key)) continue;
        loSet.add(key);
        arr.push(lo);
      }
    }
  }

  // Decide column layout.
  const ordered = DISCIPLINE_ORDER.filter((d) => presentDisciplines.has(d));
  let disciplines = ordered;
  if (disciplines.length === 0) disciplines = ["Other"];
  const singleColumn = disciplines.length < 2;
  const displayCols = singleColumn ? ["Learning Outcomes"] : disciplines;

  // Coverage targets/actuals from coverage.paper.kos when present; otherwise
  // fall back to (covered LO count) so the row still tells the teacher how
  // many LOs were touched in each KO.
  const koCovIndex = new Map(coverage.paper.kos.map((k) => [k.name, k] as const));

  const rows: KoLoGrouping["rows"] = koOrder.map((koName) => {
    const dMap = koMap.get(koName) ?? new Map<string, string[]>();
    const cells: Record<string, string> = {};
    let coveredCount = 0;
    let totalCount = 0;
    if (singleColumn) {
      const allLos: string[] = [];
      for (const arr of dMap.values()) allLos.push(...arr);
      for (const lo of allLos) {
        totalCount += 1;
        if (coveredByLo.get(lo)) coveredCount += 1;
      }
      cells["Learning Outcomes"] = formatLoList(allLos, coveredByLo);
    } else {
      for (const d of disciplines) {
        const list = dMap.get(d) ?? [];
        for (const lo of list) {
          totalCount += 1;
          if (coveredByLo.get(lo)) coveredCount += 1;
        }
        cells[d] = formatLoList(list, coveredByLo);
      }
    }
    const cov = koCovIndex.get(koName);
    return {
      name: koName,
      target: cov?.target ?? 0,
      actual: cov?.actual ?? coveredCount,
      delta: (cov?.actual ?? coveredCount) - (cov?.target ?? 0),
      loCoverage: `${coveredCount} / ${totalCount}`,
      cells,
    };
  });

  return {
    disciplines: displayCols,
    rows,
  };
}

function formatLoList(los: string[], covered: Map<string, boolean>): string {
  if (los.length === 0) return "";
  return los
    .map((lo) => `${covered.get(lo) ? "✓" : "·"} ${lo}`)
    .join("\n");
}

function buildSummarySheet(meta: TosAssessmentMeta, coverage: TosCoverage, sections: TosSection[]): XLSX.WorkSheet {
  const today = new Date().toISOString().slice(0, 10);
  const aoa: (string | number)[][] = [
    ["Table of Specifications"],
    [],
    ["Title", meta.title],
    ["Subject", meta.subject],
    ["Syllabus code", meta.syllabus_code ?? "—"],
    ["Paper", meta.paper_number ?? "—"],
    ["Level", meta.level],
    ["Duration (min)", meta.duration_minutes],
    ["Total marks", `${meta.total_actual} / ${meta.total_marks}`],
    ["Generated", today],
  ];
  if (meta.assessment_type === "past_paper_analysis") {
    aoa.push([
      "Note",
      meta.ao_targets_confirmed
        ? "Imported from past paper — AO targets confirmed by teacher."
        : "Imported from past paper — AO targets inferred from syllabus weightings; KO/LO targets reflect parsed tags. Confirm AO targets in the Coverage panel for a sharper Δ.",
    ]);
  }
  aoa.push([]);
  aoa.push(["Section breakdown"]);
  aoa.push(["Section", "Name", "Question type", "# Questions", "Marks (target)", "Marks (actual)"]);
  for (const s of sections) {
    const cov = coverage.paper.sectionMarks.find((x) => x.letter === s.letter);
    aoa.push([
      s.letter,
      s.name ?? "",
      s.question_type,
      s.num_questions,
      cov?.target ?? s.marks,
      cov?.actual ?? 0,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 36 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
  return ws;
}

function buildMatrixSheet(coverage: TosCoverage, sections: TosSection[]): XLSX.WorkSheet {
  const sectionLetters = sections.map((s) => s.letter);
  const aoa: (string | number)[][] = [];

  // ── AO table
  aoa.push(["Assessment Objectives (AO)"]);
  aoa.push([
    "Code",
    "Title",
    "Weighting %",
    "Target",
    "Actual",
    "Δ",
    ...sectionLetters.map((l) => `Sec ${l}`),
  ]);
  for (const ao of coverage.paper.aos) {
    const perSection = sections.map((s) => {
      const sec = coverage.bySection[s.id];
      return sec?.aos.find((x) => x.code === ao.code)?.actual ?? 0;
    });
    aoa.push([
      ao.code,
      ao.title ?? "",
      ao.weighting ?? "",
      ao.target,
      ao.actual,
      ao.actual - ao.target,
      ...perSection,
    ]);
  }

  // ── KO table
  aoa.push([]);
  aoa.push(["Knowledge Outcomes (KO)"]);
  aoa.push([
    "Knowledge Outcome",
    "Target",
    "Actual",
    "Δ",
    ...sectionLetters.map((l) => `Sec ${l}`),
  ]);
  for (const ko of coverage.paper.kos) {
    const perSection = sections.map((s) => {
      const sec = coverage.bySection[s.id];
      return sec?.kos.find((x) => x.name === ko.name)?.actual ?? 0;
    });
    aoa.push([
      ko.name,
      ko.target,
      ko.actual,
      ko.actual - ko.target,
      ...perSection,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const sectionCols = sectionLetters.map(() => ({ wch: 8 }));
  ws["!cols"] = [
    { wch: 60 },
    { wch: 36 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 8 },
    ...sectionCols,
  ];
  return ws;
}

function buildKoLoSheet(grouping: KoLoGrouping): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  aoa.push(["KO → LO coverage (✓ = covered by ≥1 question, · = uncovered)"]);
  aoa.push([]);
  const headers = ["Knowledge Outcome", "LOs covered", "Target", "Actual", "Δ", ...grouping.disciplines];
  aoa.push(headers);
  for (const r of grouping.rows) {
    aoa.push([
      r.name,
      r.loCoverage,
      r.target,
      r.actual,
      r.delta,
      ...grouping.disciplines.map((d) => r.cells[d] ?? ""),
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 36 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 6 },
    ...grouping.disciplines.map(() => ({ wch: 60 })),
  ];
  // Wrap LO cells.
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let R = 3; R <= range.e.r; R++) {
    for (let C = 5; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell) cell.s = { ...(cell.s ?? {}), alignment: { wrapText: true, vertical: "top" } };
    }
  }
  return ws;
}

function buildQuestionMapSheet(questions: TosQuestion[], sections: TosSection[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  aoa.push([
    "#",
    "Section",
    "Type",
    "Marks",
    "Topic",
    "Bloom",
    "Difficulty",
    "AOs",
    "KOs",
    "LOs (count)",
    "Stem",
  ]);
  questions.forEach((q, idx) => {
    aoa.push([
      idx + 1,
      sectionLetterForPosition(sections, q.position),
      q.question_type,
      q.marks,
      q.topic ?? "",
      q.bloom_level ?? "",
      q.difficulty ?? "",
      aoOf(q).join(", "),
      koOf(q).join(", "),
      loOf(q).length,
      truncate(q.stem.replace(/\s+/g, " ").trim(), 200),
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 5 }, { wch: 10 }, { wch: 16 }, { wch: 8 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 60 },
  ];
  return ws;
}

export function exportTosXlsx(args: {
  meta: TosAssessmentMeta;
  coverage: TosCoverage;
  sections: TosSection[];
  questions: TosQuestion[];
  topicIndex?: TosTopicIndexEntry[];
}): void {
  const { meta, coverage, sections, questions, topicIndex } = args;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(meta, coverage, sections), "Summary");
  XLSX.utils.book_append_sheet(wb, buildMatrixSheet(coverage, sections), "AO-KO Matrix");
  if (topicIndex && topicIndex.length > 0) {
    const grouping = buildKoLoGrouping(coverage, topicIndex);
    if (grouping.rows.length > 0) {
      XLSX.utils.book_append_sheet(wb, buildKoLoSheet(grouping), "KO → LO");
    }
  }
  XLSX.utils.book_append_sheet(wb, buildQuestionMapSheet(questions, sections), "Question Map");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, `${slug(meta.title)}-TOS.xlsx`);
}
