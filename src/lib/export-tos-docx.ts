// Export the Table of Specifications (TOS) as a Word .docx, mirroring the
// structure of the .xlsx version: paper summary, AO/KO/LO matrix, and a
// per-question map. Uses docx-js client-side.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageOrientation,
  ShadingType,
} from "docx";
import { saveAs } from "file-saver";
import type {
  TosAssessmentMeta,
  TosCoverage,
  TosSection,
  TosQuestion,
} from "@/lib/export-tos-xlsx";

const ARIAL = "Arial";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "assessment";
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// Strip characters that are illegal in OOXML (control chars except \t \n \r).
// Word refuses to open files containing them, which manifests as a generic
// "file is corrupt" error on the user's machine.
function sanitizeXmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function txt(value: string | number | null | undefined, opts?: { bold?: boolean; size?: number }): Paragraph {
  const raw = value == null || value === "" ? "" : String(value);
  return new Paragraph({
    children: [
      new TextRun({
        text: sanitizeXmlText(raw),
        font: ARIAL,
        size: opts?.size ?? 18,
        bold: opts?.bold ?? false,
      }),
    ],
  });
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "E8EEF7", type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [txt(text, { bold: true })],
  });
}

function dataCell(text: string | number | null | undefined, width: number): TableCell {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [txt(text)],
  });
}

function buildKeyValueTable(rows: { k: string; v: string | number }[]): Table {
  const colKey = 2880;
  const colVal = 9000;
  const total = colKey + colVal;
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: [colKey, colVal],
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({
              borders: cellBorders,
              width: { size: colKey, type: WidthType.DXA },
              shading: { fill: "F4F6FA", type: ShadingType.CLEAR, color: "auto" },
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [txt(r.k, { bold: true })],
            }),
            dataCell(r.v, colVal),
          ],
        }),
    ),
  });
}

function buildGridTable(headers: string[], rows: (string | number)[][], columnWidths: number[]): Table {
  const total = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => headerCell(h, columnWidths[i])),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((cell, i) => dataCell(cell, columnWidths[i])),
          }),
      ),
    ],
  });
}

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: ARIAL, bold: true, size: level === HeadingLevel.HEADING_1 ? 32 : 26 })],
  });
}

function spacer(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: "", font: ARIAL })] });
}

function distributeWidths(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor((w / sum) * total));
  // Adjust last column to absorb rounding so they sum exactly to total
  const diff = total - widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] += diff;
  return widths;
}

export async function exportTosDocx(args: {
  meta: TosAssessmentMeta;
  coverage: TosCoverage;
  sections: TosSection[];
  questions: TosQuestion[];
}): Promise<void> {
  const { meta, coverage, sections, questions } = args;
  const today = new Date().toISOString().slice(0, 10);

  // Landscape A4-ish: keep the matrix readable when many sections exist.
  // Content width with 1" margins: 15840 - 2880 = 12960 DXA.
  const contentWidth = 12960;

  const sectionLetters = sections.map((s) => s.letter);

  // ── Summary
  const summaryRows: { k: string; v: string | number }[] = [
    { k: "Title", v: meta.title },
    { k: "Subject", v: meta.subject },
    { k: "Syllabus code", v: meta.syllabus_code ?? "—" },
    { k: "Level", v: meta.level },
    { k: "Duration (min)", v: meta.duration_minutes },
    { k: "Total marks", v: `${meta.total_actual} / ${meta.total_marks}` },
    { k: "Generated", v: today },
  ];
  if (meta.assessment_type === "past_paper_analysis") {
    summaryRows.push({
      k: "Note",
      v: meta.ao_targets_confirmed
        ? "Imported from past paper — AO targets confirmed by teacher."
        : "Imported from past paper — AO targets inferred from syllabus weightings; KO/LO targets reflect parsed tags.",
    });
  }

  // ── Section breakdown
  const sectionHeaders = ["Section", "Name", "Question type", "# Questions", "Marks (target)", "Marks (actual)"];
  const sectionWidths = distributeWidths(contentWidth, [1, 4, 3, 1.5, 1.8, 1.8]);
  const sectionRows = sections.map((s) => {
    const cov = coverage.paper.sectionMarks.find((x) => x.letter === s.letter);
    return [
      s.letter,
      s.name ?? "",
      s.question_type,
      s.num_questions,
      cov?.target ?? s.marks,
      cov?.actual ?? 0,
    ] as (string | number)[];
  });

  // ── AO matrix
  const aoBaseWeights = [0.8, 3, 1.2, 1, 1, 0.8];
  const aoSectionWeights = sectionLetters.map(() => 0.7);
  const aoWidths = distributeWidths(contentWidth, [...aoBaseWeights, ...aoSectionWeights]);
  const aoHeaders = ["Code", "Title", "Weighting %", "Target", "Actual", "Δ", ...sectionLetters.map((l) => `Sec ${l}`)];
  const aoRows = coverage.paper.aos.map((ao) => {
    const perSection = sections.map((s) => coverage.bySection[s.id]?.aos.find((x) => x.code === ao.code)?.actual ?? 0);
    return [
      ao.code,
      ao.title ?? "",
      ao.weighting ?? "",
      ao.target,
      ao.actual,
      ao.actual - ao.target,
      ...perSection,
    ] as (string | number)[];
  });

  // ── KO matrix
  const koBaseWeights = [4, 1, 1, 0.8];
  const koSectionWeights = sectionLetters.map(() => 0.7);
  const koWidths = distributeWidths(contentWidth, [...koBaseWeights, ...koSectionWeights]);
  const koHeaders = ["Knowledge Outcome", "Target", "Actual", "Δ", ...sectionLetters.map((l) => `Sec ${l}`)];
  const koRows = coverage.paper.kos.map((ko) => {
    const perSection = sections.map((s) => coverage.bySection[s.id]?.kos.find((x) => x.name === ko.name)?.actual ?? 0);
    return [ko.name, ko.target, ko.actual, ko.actual - ko.target, ...perSection] as (string | number)[];
  });

  // (LO matrix removed — KO-level breakdown is sufficient for the TOS)

  // ── Question map
  const sectionLetterForPosition = (position: number): string => {
    let cursor = 0;
    for (const s of sections) {
      if (position < cursor + (s.num_questions || 0)) return s.letter;
      cursor += s.num_questions || 0;
    }
    return sections[sections.length - 1]?.letter ?? "";
  };
  const qHeaders = ["#", "Section", "Type", "Marks", "Topic", "Bloom", "Difficulty", "AOs", "KOs", "LOs", "Stem"];
  const qWidths = distributeWidths(contentWidth, [0.5, 0.8, 1.4, 0.7, 2, 1, 1, 1.4, 2, 0.7, 5]);
  const qRows = questions.map((q, idx) => {
    return [
      idx + 1,
      sectionLetterForPosition(q.position),
      q.question_type,
      q.marks,
      q.topic ?? "",
      q.bloom_level ?? "",
      q.difficulty ?? "",
      (q.ao_codes ?? []).join(", "),
      (q.knowledge_outcomes ?? []).join(", "),
      (q.learning_outcomes ?? []).length,
      truncate(q.stem.replace(/\s+/g, " ").trim(), 220),
    ] as (string | number)[];
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: ARIAL, size: 18 } } },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "Table of Specifications", font: ARIAL, bold: true, size: 36 }),
            ],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({ text: meta.title, font: ARIAL, size: 22, italics: true }),
            ],
          }),
          buildKeyValueTable(summaryRows),
          spacer(),
          heading("Section breakdown", HeadingLevel.HEADING_2),
          buildGridTable(sectionHeaders, sectionRows, sectionWidths),
          spacer(),
          heading("Assessment Objectives (AO)", HeadingLevel.HEADING_2),
          buildGridTable(aoHeaders, aoRows.length > 0 ? aoRows : [aoHeaders.map(() => "")], aoWidths),
          spacer(),
          heading("Knowledge Outcomes (KO)", HeadingLevel.HEADING_2),
          buildGridTable(koHeaders, koRows.length > 0 ? koRows : [koHeaders.map(() => "")], koWidths),
          spacer(),
          heading("Question map", HeadingLevel.HEADING_2),
          buildGridTable(qHeaders, qRows.length > 0 ? qRows : [qHeaders.map(() => "")], qWidths),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${slug(meta.title)}-TOS.docx`);
}
