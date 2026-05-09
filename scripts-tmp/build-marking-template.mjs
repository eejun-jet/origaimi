// Build the Setters/Markers Deployment template:
//   - Editable roster (Andy, Barry, Cecilia, …) at the top, used as the source
//     for Setter / Marker dropdowns via a named range.
//   - Assessment + Stream + Term dropdowns via named ranges.
//   - Body grouped by Term 1..4 with banner rows the importer ignores.
//
// Run: node scripts-tmp/build-marking-template.mjs
// Out: public/templates/setters-markers-template.xlsx

import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const out = resolve("public/templates/setters-markers-template.xlsx");
mkdirSync(dirname(out), { recursive: true });

const ROSTER = [
  "Andy", "Barry", "Cecilia", "Douglas", "Elaine",
  "Fiona", "Gerald", "Hannah", "Imran", "Jocelyn",
  "Kenneth", "Lina", "Marcus", "Nadia", "Oliver",
  "Priya", "Quentin", "Rohan", "Siti", "Tomás",
  "Uma", "Vikram", "Wendy", "Xavier", "Yasmin", "Zane",
];

const ASSESSMENTS = ["WA1", "WA2", "WA3", "Exam"];
const STREAMS = ["G3", "G2", "G1", "G3+G2", "G3+G2+G1"];
const TERMS = ["T1", "T2", "T3", "T4"];

const HEADERS = [
  "SN", "Term", "Assessment", "Stream", "Level", "Subject", "Duration",
  "Setter", "Marker", "Classes",
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "Total", "Remarks",
];

const aoa = [];

// Title
aoa.push(["Setters & Markers Deployment Template — fill in by Term"]);
aoa.push([]);

// Roster block (4 columns × N rows)
aoa.push(["ROSTER — overwrite with your colleagues' real names. Dropdowns below update automatically."]);
const rosterCols = 4;
const rosterRows = Math.ceil(ROSTER.length / rosterCols);
for (let r = 0; r < rosterRows; r++) {
  const row = [];
  for (let c = 0; c < rosterCols; c++) {
    const i = c * rosterRows + r;
    row.push(ROSTER[i] ?? "");
  }
  aoa.push(row);
}
aoa.push([]);

// Form-level fields
aoa.push(["Department:", "", "Year:", new Date().getFullYear()]);
aoa.push([]);

// Header row
const headerRowIdx = aoa.length; // 0-based row index in aoa
aoa.push(HEADERS);

let sn = 0;
const dataRows = [];

function termBanner(label) {
  // Importer recognises rows whose Level cell starts with "───" or "TERM"
  return ["", "", "", "", `─── ${label} ───`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
}

function exampleRow(term, assessment, stream, level, subject, duration, setter, marker, classes, counts, remarks) {
  sn += 1;
  const padded = [...counts];
  while (padded.length < 10) padded.push("");
  const startCol = "K"; // 1..10 columns start at K (col index 10, 0-based) → Excel K
  const endCol = "T";
  const row = [
    sn, term, assessment, stream, level, subject, duration,
    setter, marker, classes,
    ...padded,
    `=SUM(${startCol}${aoa.length + dataRows.length + 1}:${endCol}${aoa.length + dataRows.length + 1})`,
    remarks,
  ];
  return row;
}

// TERM 1
dataRows.push(termBanner("TERM 1"));
dataRows.push(exampleRow("T1", "WA1", "G3", "Sec 3", "Combined Science (Phy/Chem)", "1h", "Andy", "Andy", "3A1, 3A2", [40, 38], "(example — delete)"));
dataRows.push(exampleRow("T1", "WA1", "G2", "Sec 3", "Combined Science (Phy/Chem)", "45m", "Andy", "Barry", "3N1", [35], "(example — G2 variant of paper above)"));

// TERM 2
dataRows.push(termBanner("TERM 2"));
dataRows.push(exampleRow("T2", "WA2", "G3+G2", "Sec 1", "Geography", "1h", "Cecilia", "Cecilia / Douglas", "1A1, 1A2", [38, 39], "(example — co-marked)"));

// TERM 3
dataRows.push(termBanner("TERM 3"));
dataRows.push(exampleRow("T3", "WA3", "G3", "Sec 2", "History", "1h", "Elaine", "Elaine", "2A1", [37], "(example)"));

// TERM 4
dataRows.push(termBanner("TERM 4"));
dataRows.push(exampleRow("T4", "Exam", "G3", "Sec 3", "Combined Science (Phy/Chem)", "1h 45m", "Andy", "Andy / Barry", "3A1, 3A2", [40, 38], "(example — full paper, EoY)"));
dataRows.push(exampleRow("T4", "Exam", "G2", "Sec 3", "Combined Science (Phy/Chem)", "1h 30m", "Andy", "Barry", "3N1", [35], "(example — G2 variant, 1pt setting)"));
dataRows.push(exampleRow("T4", "Exam", "G1", "Sec 3", "Science (Foundation)", "1h", "Fiona", "Fiona", "3T1", [22], "(example — G1, 1pt setting)"));

// Empty editable rows under each term (5 each) — give users space to fill in
function blankRow() { return ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]; }

// Splice 5 blanks after each banner+examples block already added
// Simpler: just append a buffer of banners + blanks for clean expansion later
dataRows.push([]);
for (const t of TERMS) {
  dataRows.push(termBanner(`${t === "T1" ? "TERM 1" : t === "T2" ? "TERM 2" : t === "T3" ? "TERM 3" : "TERM 4"} (more rows)`));
  for (let i = 0; i < 6; i++) dataRows.push(blankRow());
}

for (const r of dataRows) aoa.push(r);

aoa.push([]);
aoa.push(["How to fill this in"]);
const NOTES = [
  ["• Roster: rename Andy/Barry/… at the top to your real colleagues. Setter and Marker dropdowns pick from that list."],
  ["• Co-setting / co-marking: pick one name then type \" / \" + the second name (e.g. \"Andy / Barry\"). Points are split."],
  ["• Term: T1–T4. The dashboard groups deployments by term."],
  ["• Assessment: WA1 / WA2 / WA3 / Exam. WAs are 1pt; Exam is a full paper (G3=2pt, G2 standalone=1.5pt, G2 variant of G3=1pt, G1=1pt)."],
  ["• Stream: G3 / G2 / G1, or combos like G3+G2 if one paper covers both. G2/G1 papers sharing Subject + Year + Department with a G3 paper auto-link as variants."],
  ["• Per-class scripts: enter counts in columns 1..10 in the same order as the Classes cell. Total = SUM."],
  ["• Banner rows (─── TERM x ───) are ignored by the importer — they're just visual dividers."],
];
for (const n of NOTES) aoa.push(n);

const ws = XLSX.utils.aoa_to_sheet(aoa);

ws["!cols"] = [
  { wch: 4 },   // SN
  { wch: 6 },   // Term
  { wch: 12 },  // Assessment
  { wch: 12 },  // Stream
  { wch: 10 },  // Level
  { wch: 32 },  // Subject
  { wch: 10 },  // Duration
  { wch: 14 },  // Setter
  { wch: 22 },  // Marker
  { wch: 18 },  // Classes
  ...Array.from({ length: 10 }, () => ({ wch: 5 })), // 1..10
  { wch: 8 },   // Total
  { wch: 36 },  // Remarks
];

ws["!merges"] = [
  { s: { r: 0, c: 0 }, e: { r: 0, c: HEADERS.length - 1 } },
  { s: { r: 2, c: 0 }, e: { r: 2, c: HEADERS.length - 1 } },
];

ws["!freeze"] = { xSplit: 0, ySplit: headerRowIdx + 1 };

// --- Named ranges + data validation ---
// XLSX.js community lacks first-class data validation API, but Excel reads
// workbook-level defined names just fine. We compute roster cell range so
// renaming works automatically.
//
// Roster occupies aoa rows 3..(3 + rosterRows - 1), cols 0..(rosterCols-1).
// Build a multi-area reference for the named range "Teachers".
const rosterStartAoaRow = 3; // 0-based
const a1 = (r, c) => `${XLSX.utils.encode_col(c)}${r + 1}`;
const rosterAreas = [];
for (let c = 0; c < rosterCols; c++) {
  const top = a1(rosterStartAoaRow, c);
  const bot = a1(rosterStartAoaRow + rosterRows - 1, c);
  rosterAreas.push(`Deployment!$${XLSX.utils.encode_col(c)}$${rosterStartAoaRow + 1}:$${XLSX.utils.encode_col(c)}$${rosterStartAoaRow + rosterRows}`);
  void top; void bot;
}

// Hidden lookup sheet for Assessment / Stream / Term lists (Excel needs a real range for list validation).
const lookup = [["Assessments", "Streams", "Terms"]];
const maxLookup = Math.max(ASSESSMENTS.length, STREAMS.length, TERMS.length);
for (let i = 0; i < maxLookup; i++) {
  lookup.push([ASSESSMENTS[i] ?? "", STREAMS[i] ?? "", TERMS[i] ?? ""]);
}
const wsLookup = XLSX.utils.aoa_to_sheet(lookup);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Deployment");
XLSX.utils.book_append_sheet(wb, wsLookup, "Lists");

// Defined names
wb.Workbook = wb.Workbook || {};
wb.Workbook.Names = [
  { Name: "Teachers", Ref: rosterAreas.join(",") },
  { Name: "Assessments", Ref: `Lists!$A$2:$A$${ASSESSMENTS.length + 1}` },
  { Name: "Streams", Ref: `Lists!$B$2:$B$${STREAMS.length + 1}` },
  { Name: "Terms", Ref: `Lists!$C$2:$C$${TERMS.length + 1}` },
];

// --- Data validation via raw XML injection ---
// xlsx writes !dataValidation if we attach to ws. Build ranges over the data area.
const headerExcelRow = headerRowIdx + 1; // 1-based Excel row of headers
const firstDataRow = headerExcelRow + 1;
const lastDataRow = headerExcelRow + dataRows.length;

const colLetter = (i) => XLSX.utils.encode_col(i);
const colTerm = colLetter(HEADERS.indexOf("Term"));
const colAssess = colLetter(HEADERS.indexOf("Assessment"));
const colStream = colLetter(HEADERS.indexOf("Stream"));
const colSetter = colLetter(HEADERS.indexOf("Setter"));
const colMarker = colLetter(HEADERS.indexOf("Marker"));

ws["!dataValidation"] = [
  { sqref: `${colTerm}${firstDataRow}:${colTerm}${lastDataRow}`, type: "list", formula1: "=Terms" },
  { sqref: `${colAssess}${firstDataRow}:${colAssess}${lastDataRow}`, type: "list", formula1: "=Assessments" },
  { sqref: `${colStream}${firstDataRow}:${colStream}${lastDataRow}`, type: "list", formula1: "=Streams" },
  // Setter/Marker: list with showError=false so free-text combos like "Andy / Barry" still work
  { sqref: `${colSetter}${firstDataRow}:${colSetter}${lastDataRow}`, type: "list", formula1: "=Teachers", showErrorMessage: false, errorStyle: "warning" },
  { sqref: `${colMarker}${firstDataRow}:${colMarker}${lastDataRow}`, type: "list", formula1: "=Teachers", showErrorMessage: false, errorStyle: "warning" },
];

const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);
