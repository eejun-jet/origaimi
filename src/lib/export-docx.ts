// Export an assessment to a Word .docx that follows the standard exam-paper
// layout (cover, instructions, sectioned questions with mark column, mark
// scheme appendix). Uses docx-js client-side so no edge function is needed.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  LevelFormat,
  PageOrientation,
  Footer,
  PageNumber,
} from "docx";
import { saveAs } from "file-saver";
import { toSectioned, getSbqSkill, type Section } from "@/lib/sections";

export type ExportQuestion = {
  position: number;
  question_type: string;
  topic: string | null;
  bloom_level: string | null;
  difficulty: string | null;
  marks: number;
  stem: string;
  options: string[] | null;
  answer: string | null;
  mark_scheme: string | null;
};

export type ExportAssessment = {
  title: string;
  subject: string;
  level: string;
  total_marks: number;
  duration_minutes: number;
  instructions: string | null;
  blueprint: unknown;
};

const ARIAL = "Arial";

// Strip C0 control bytes (except \t \n \r) and lone surrogate halves; Word
// rejects OOXML containing them and reports the file as corrupt.
function clean(s: string | null | undefined): string {
  if (s == null) return "";
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function p(text: string, opts: { bold?: boolean; size?: number; align?: typeof AlignmentType[keyof typeof AlignmentType]; spacingAfter?: number } = {}) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.spacingAfter ?? 120 },
    children: [new TextRun({ text: clean(text), bold: opts.bold, size: opts.size ?? 22, font: ARIAL })],
  });
}

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel], size = 28) {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 160 },
    children: [new TextRun({ text: clean(text), bold: true, size, font: ARIAL })],
  });
}

function bullet(text: string) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text: clean(text), size: 22, font: ARIAL })],
  });
}

function questionRow(qNumber: number, q: ExportQuestion): Table {
  const stem = q.stem.trim();
  const optLines: Paragraph[] = [];
  if (q.question_type === "mcq" && q.options && q.options.length > 0) {
    q.options.forEach((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      optLines.push(
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [new TextRun({ text: `${letter}. ${opt}`, size: 22, font: ARIAL })],
        }),
      );
    });
  }

  const numberCell = new TableCell({
    width: { size: 700, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    borders: noBorders(),
    children: [new Paragraph({ children: [new TextRun({ text: `${qNumber}.`, bold: true, size: 22, font: ARIAL })] })],
  });

  const bodyChildren: Paragraph[] = [
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: stem, size: 22, font: ARIAL })],
    }),
    ...optLines,
  ];
  if (q.question_type !== "mcq") {
    // Answer-writing space hint
    const lines = Math.min(12, Math.max(2, q.marks * 2));
    for (let i = 0; i < lines; i++) {
      bodyChildren.push(
        new Paragraph({
          spacing: { after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 6 } },
          children: [new TextRun({ text: " ", size: 22, font: ARIAL })],
        }),
      );
    }
  }

  const bodyCell = new TableCell({
    width: { size: 7960, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    borders: noBorders(),
    children: bodyChildren,
  });

  const marksCell = new TableCell({
    width: { size: 700, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    borders: noBorders(),
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: `[${q.marks}]`, size: 22, font: ARIAL })],
      }),
    ],
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [700, 7960, 700],
    rows: [new TableRow({ children: [numberCell, bodyCell, marksCell] })],
  });
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: none, bottom: none, left: none, right: none };
}

export async function exportAssessmentDocx(
  assessment: ExportAssessment,
  questions: ExportQuestion[],
) {
  const sectioned = toSectioned(assessment.blueprint);
  const sections: Section[] = sectioned.sections;

  // Group questions by section based on cumulative num_questions.
  const grouped: Array<{ section: Section | null; items: ExportQuestion[] }> = [];
  if (sections.length === 0) {
    grouped.push({ section: null, items: questions });
  } else {
    let cursor = 0;
    sections.forEach((s) => {
      const n = s.num_questions || 0;
      const items = questions.filter((q) => q.position >= cursor && q.position < cursor + n);
      grouped.push({ section: s, items });
      cursor += n;
    });
    // Trailing questions that didn't match any section
    const tail = questions.filter((q) => q.position >= cursor);
    if (tail.length > 0) grouped.push({ section: null, items: tail });
  }

  // ── Cover page ──
  const cover: Paragraph[] = [
    p(assessment.subject.toUpperCase(), { bold: true, size: 28, align: AlignmentType.CENTER, spacingAfter: 60 }),
    p(assessment.level, { align: AlignmentType.CENTER, size: 24, spacingAfter: 240 }),
    p(assessment.title, { bold: true, size: 36, align: AlignmentType.CENTER, spacingAfter: 480 }),
    p(`Duration: ${assessment.duration_minutes} minutes`, { align: AlignmentType.CENTER, spacingAfter: 60 }),
    p(`Total marks: ${assessment.total_marks}`, { align: AlignmentType.CENTER, spacingAfter: 480 }),
    heading("INSTRUCTIONS TO CANDIDATES", HeadingLevel.HEADING_2, 24),
  ];

  const defaultInstr = [
    "Write your name and class on the cover sheet.",
    "Answer all questions unless otherwise indicated.",
    "Write your answers in the spaces provided.",
    "The number of marks is given in brackets [ ] at the end of each question or part question.",
  ];
  const instrLines = (assessment.instructions ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  (instrLines.length > 0 ? instrLines : defaultInstr).forEach((line) => cover.push(bullet(line)));

  cover.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Section pages ──
  const body: (Paragraph | Table)[] = [];
  let runningQ = 0;
  grouped.forEach(({ section, items }, gi) => {
    if (items.length === 0) return;
    if (section) {
      const sectionMarks = items.reduce((acc, q) => acc + q.marks, 0);
      const skillLabel = getSbqSkill(section.sbq_skill)?.label;
      const headerSuffix = skillLabel ? ` — Source-Based Question (${skillLabel})` : (section.name ? ` — ${section.name}` : "");
      body.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: `Section ${section.letter}${headerSuffix}`, bold: true, size: 32, font: ARIAL })],
        }),
      );
      body.push(
        p(`[${sectionMarks} marks]`, { align: AlignmentType.CENTER, size: 22, spacingAfter: 120 }),
      );
      if (section.instructions) {
        body.push(p(section.instructions, { align: AlignmentType.CENTER, size: 22, spacingAfter: 240 }));
      }
    }
    items.forEach((q) => {
      runningQ += 1;
      body.push(questionRow(runningQ, q));
      body.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "" })] }));
    });
    if (gi < grouped.length - 1) {
      body.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  body.push(p("— END OF PAPER —", { align: AlignmentType.CENTER, bold: true, spacingAfter: 120 }));

  // ── Mark scheme appendix ──
  const ms: Paragraph[] = [
    new Paragraph({ children: [new PageBreak()] }),
    heading("MARK SCHEME", HeadingLevel.HEADING_1, 32),
  ];
  let msQ = 0;
  grouped.forEach(({ section, items }) => {
    if (items.length === 0) return;
    if (section) {
      const skillLabel = getSbqSkill(section.sbq_skill)?.label;
      const suffix = skillLabel ? ` — Source-Based (${skillLabel})` : (section.name ? " — " + section.name : "");
      ms.push(p(`Section ${section.letter}${suffix}`, { bold: true, size: 24, spacingAfter: 80 }));
    }
    items.forEach((q) => {
      msQ += 1;
      ms.push(p(`Q${msQ}. (${q.marks} mark${q.marks === 1 ? "" : "s"})`, { bold: true, spacingAfter: 60 }));
      if (q.answer) ms.push(p(`Answer: ${q.answer}`, { spacingAfter: 60 }));
      if (q.mark_scheme) ms.push(p(q.mark_scheme, { spacingAfter: 160 }));
    });
  });

  const doc = new Document({
    creator: "origAImi",
    title: assessment.title,
    description: `${assessment.subject} — ${assessment.level}`,
    styles: {
      default: { document: { run: { font: ARIAL, size: 22 } } },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 18, font: ARIAL }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, font: ARIAL }),
                  new TextRun({ text: " of ", size: 18, font: ARIAL }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, font: ARIAL }),
                ],
              }),
            ],
          }),
        },
        children: [...cover, ...body, ...ms],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safeTitle = assessment.title.replace(/[^a-z0-9-_ ]+/gi, "").trim() || "assessment";
  saveAs(blob, `${safeTitle}.docx`);
}
