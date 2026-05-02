// Export the Table of Specifications (TOS) for an assessment as an .xlsx
// workbook with three sheets: paper summary, AO/KO/LO matrix, and a
// per-question map. Pure client-side — uses SheetJS (xlsx) which is already
// installed in the project.

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

export type TosAssessmentMeta = {
  title: string;
  subject: string;
  level: string;
  syllabus_code: string | null;
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

function buildSummarySheet(meta: TosAssessmentMeta, coverage: TosCoverage, sections: TosSection[]): XLSX.WorkSheet {
  const today = new Date().toISOString().slice(0, 10);
  const aoa: (string | number)[][] = [
    ["Table of Specifications"],
    [],
    ["Title", meta.title],
    ["Subject", meta.subject],
    ["Syllabus code", meta.syllabus_code ?? "—"],
    ["Level", meta.level],
    ["Duration (min)", meta.duration_minutes],
    ["Total marks", `${meta.total_actual} / ${meta.total_marks}`],
    ["Generated", today],
  ];
  if (meta.assessment_type === "past_paper_analysis") {
    aoa.push(["Note", "Imported from past paper — targets inferred from parsed tags."]);
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

  // ── LO table
  aoa.push([]);
  aoa.push(["Learning Outcomes (LO)"]);
  aoa.push([
    "Learning Outcome",
    "Target hits",
    "Actual hits",
    "Covered",
    ...sectionLetters.map((l) => `Sec ${l}`),
  ]);
  for (const lo of coverage.paper.los) {
    const perSection = sections.map((s) => {
      const sec = coverage.bySection[s.id];
      return sec?.los.find((x) => x.text === lo.text)?.actual ?? 0;
    });
    aoa.push([
      truncate(lo.text, 250),
      lo.target,
      lo.actual,
      lo.covered ? "Yes" : "No",
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
}): void {
  const { meta, coverage, sections, questions } = args;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(meta, coverage, sections), "Summary");
  XLSX.utils.book_append_sheet(wb, buildMatrixSheet(coverage, sections), "AO-KO-LO Matrix");
  XLSX.utils.book_append_sheet(wb, buildQuestionMapSheet(questions, sections), "Question Map");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, `${slug(meta.title)}-TOS.xlsx`);
}
