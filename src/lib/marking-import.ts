// Parse the school's "Setters/Markers List" XLSX into draft papers + deployments.
// Sample shape (Northland Sec 2019 Humanities):
//   SN | Level | Subject | Duration | Setter(s) | Marker(s) | Classes | 1..10 | Total | Remarks
// Co-marking like "A/B" is split into one deployment per marker. Multiple
// rows under the same paper (subject+level+duration) inherit the setter
// from the first row when blank.

import * as XLSX from "xlsx";

export type ParsedDeployment = {
  role: "setter" | "marker";
  teacher_name: string;
  class_label: string | null;
  script_count: number;
};

export type ParsedPaper = {
  title: string; // synthesised: `${level} ${subject}`
  subject: string;
  level: string;
  stream: string | null; // Exp / NA / NT / null
  duration_minutes: number | null;
  assessment_type: string | null; // WA1, MYE, EoY, … (column or form default)
  remarks: string | null;
  deployments: ParsedDeployment[];
};

export type ParsedImport = {
  papers: ParsedPaper[];
  warnings: string[];
  uniqueNames: string[];
};

const HEADER_ALIASES: Record<string, string> = {
  level: "level",
  subject: "subject",
  duration: "duration",
  "setter(s)": "setter",
  setters: "setter",
  setter: "setter",
  "marker(s)": "marker",
  markers: "marker",
  marker: "marker",
  classes: "classes",
  class: "classes",
  total: "total",
  remarks: "remarks",
  assessment: "assessment",
  "assessment type": "assessment",
};

function normaliseHeader(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function parseDuration(raw: unknown): number | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  // "1h 10 min", "1 h 45 min", "1 h", "70 min"
  const hMatch = s.match(/(\d+)\s*h/);
  const mMatch = s.match(/(\d+)\s*m/);
  const h = hMatch ? parseInt(hMatch[1], 10) : 0;
  const m = mMatch ? parseInt(mMatch[1], 10) : 0;
  const total = h * 60 + m;
  return total > 0 ? total : null;
}

function parseStream(level: string): string | null {
  const m = level.match(/\b(Exp|Express|NA|N\(A\)|NT|N\(T\)|IP)\b/i);
  if (!m) return null;
  const v = m[1].toUpperCase();
  if (v.startsWith("EXP")) return "Exp";
  if (v.startsWith("NA") || v === "N(A)") return "NA";
  if (v.startsWith("NT") || v === "N(T)") return "NT";
  return v;
}

function splitNames(cell: unknown): string[] {
  return String(cell ?? "")
    .split(/[\/,&]| and /i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitClasses(cell: unknown): string[] {
  return String(cell ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseMarkingXlsx(buffer: ArrayBuffer): ParsedImport {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

  // Find the header row (contains "Level" and "Subject")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map((c) => normaliseHeader(String(c ?? "")));
    if (cells.includes("level") && cells.includes("subject")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return { papers: [], warnings: ["Could not find a header row containing 'Level' and 'Subject'."], uniqueNames: [] };
  }

  const header = rows[headerIdx].map((c) => normaliseHeader(String(c ?? "")));
  const colIndex = (key: string) => header.findIndex((h) => HEADER_ALIASES[h] === key);
  const idx = {
    level: colIndex("level"),
    subject: colIndex("subject"),
    duration: colIndex("duration"),
    setter: colIndex("setter"),
    marker: colIndex("marker"),
    classes: colIndex("classes"),
    remarks: colIndex("remarks"),
    total: colIndex("total"),
    assessment: colIndex("assessment"),
  };

  // Per-class numeric columns sit between "Classes" and "Total"
  const perClassCols: number[] = [];
  if (idx.classes >= 0 && idx.total > idx.classes) {
    for (let c = idx.classes + 1; c < idx.total; c++) perClassCols.push(c);
  }

  const papers: ParsedPaper[] = [];
  const warnings: string[] = [];
  const nameSet = new Set<string>();

  // Group rows that share level+subject+duration: subsequent rows with blank
  // level+subject continue the prior paper but add more markers (this matches
  // the spreadsheet shape where extra marker rows have empty Subject cells).
  let current: ParsedPaper | null = null;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const level = String(row[idx.level] ?? "").trim();
    const subject = String(row[idx.subject] ?? "").trim();
    const duration = parseDuration(row[idx.duration]);
    const setterCell = idx.setter >= 0 ? row[idx.setter] : "";
    const markerCell = idx.marker >= 0 ? row[idx.marker] : "";
    const classesCell = idx.classes >= 0 ? row[idx.classes] : "";
    const remarks = idx.remarks >= 0 ? String(row[idx.remarks] ?? "").trim() : "";
    const assessmentCell = idx.assessment >= 0 ? String(row[idx.assessment] ?? "").trim() : "";

    const startsNewPaper = !!level && !!subject;
    if (startsNewPaper) {
      current = {
        title: `${level} ${subject}`.trim(),
        subject,
        level,
        stream: parseStream(level),
        duration_minutes: duration,
        assessment_type: assessmentCell || null,
        remarks: remarks || null,
        deployments: [],
      };
      papers.push(current);

      // Setter(s) → one deployment per setter, no class
      for (const name of splitNames(setterCell)) {
        nameSet.add(name);
        current.deployments.push({ role: "setter", teacher_name: name, class_label: null, script_count: 0 });
      }
    } else if (!current) {
      warnings.push(`Row ${r + 1}: marker line with no preceding paper — skipped.`);
      continue;
    }

    // Markers → one deployment per (marker × class). Per-class counts pulled
    // from per-class numeric columns; if classes ≠ counts length, fall back
    // to splitting classes alone with 0 counts.
    const markers = splitNames(markerCell);
    const classes = splitClasses(classesCell);
    if (markers.length === 0 && classes.length === 0) continue;
    if (!current) continue;
    const paper = current;

    // Read per-class counts for this row (positional)
    const counts = perClassCols.map((c) => Number(row[c] ?? 0)).map((n) => (Number.isFinite(n) ? n : 0));
    const classCounts = classes.map((cls, i) => ({ cls, count: counts[i] ?? 0 }));

    for (const name of markers) {
      nameSet.add(name);
      if (classCounts.length === 0) {
        paper.deployments.push({ role: "marker", teacher_name: name, class_label: null, script_count: 0 });
      } else {
        for (const { cls, count } of classCounts) {
          paper.deployments.push({ role: "marker", teacher_name: name, class_label: cls, script_count: count });
        }
      }
    }
  }

  return { papers, warnings, uniqueNames: Array.from(nameSet).sort() };
}
