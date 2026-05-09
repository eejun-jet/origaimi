// Generate the clean, logo-less Setters/Markers deployment template.
// Run with: node scripts-tmp/build-marking-template.mjs
// Output:   public/templates/setters-markers-template.xlsx

import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const out = resolve("public/templates/setters-markers-template.xlsx");
mkdirSync(dirname(out), { recursive: true });

const HEADERS = [
  "SN",
  "Assessment",
  "Level",
  "Subject",
  "Duration",
  "Setter(s)",
  "Marker(s)",
  "Classes",
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "Total",
  "Remarks",
];

const rows = [];

// Title row
rows.push(["Setters & Markers Deployment Template"]);
// Field row
rows.push(["Department:", "", "Year:", "", "Default Assessment:", "(WA1 / WA2 / MYE / EoY)"]);
// Spacer
rows.push([]);
// Header row
rows.push(HEADERS);

// Example rows (illustrative — users can delete)
rows.push([
  1, "EoY", "Sec 3 Exp", "Combined Science (Phy/Chem)", "1h 45m",
  "Tan Wei Ming",
  "Tan Wei Ming",
  "3A1, 3A2",
  40, 38, "", "", "", "", "", "", "", "",
  "=SUM(I5:R5)",
  "MCQ + structured",
]);
rows.push([
  2, "EoY", "Sec 3 NA", "Combined Science (Phy/Chem)", "1h 30m",
  "Tan Wei Ming",
  "Lim Hui Ling / Chen Huifen",
  "3N1",
  35, "", "", "", "", "", "", "", "", "",
  "=SUM(I6:R6)",
  "G2 variant of paper 1 (auto-detected)",
]);
rows.push([
  3, "WA2", "Sec 1 Exp", "Geography", "1h",
  "Saramma Matthews",
  "Saramma Matthews",
  "1A1, 1A2, 1A3",
  38, 39, 37, "", "", "", "", "", "", "",
  "=SUM(I7:R7)",
  "Term 3 weighted assessment",
]);

// Spacer
rows.push([]);
rows.push([]);

// Notes block
const NOTES = [
  ["How to fill this in"],
  ["• Assessment: WA1 / WA2 / WA3 / CA1 / CA2 / MYE / EoY / Prelim. Drives points and year-round filtering."],
  ["• Co-setters or co-markers: separate names with a forward slash, e.g. \"A Tan / B Lim\". Points are split between them."],
  ["• Multiple classes for the same marker: comma-separated, e.g. \"3A1, 3A2\". Per-class script counts go in columns 1–10 in the same order."],
  ["• Continuation rows: leave Level / Subject blank to add another marker to the previous paper."],
  ["• Duration: \"1h 45m\", \"1h\", \"45 min\" all work."],
  ["• G2 / NA papers that share Subject + Year + Department with a G3 / Express paper are automatically detected as variants and score 1 setting point (vs 2 for the G3)."],
  ["• Total formula =SUM(I:R) is filled in automatically; you can leave it as is."],
];
for (const n of NOTES) rows.push(n);

const ws = XLSX.utils.aoa_to_sheet(rows);

// Column widths
ws["!cols"] = [
  { wch: 4 },   // SN
  { wch: 12 },  // Assessment
  { wch: 12 },  // Level
  { wch: 32 },  // Subject
  { wch: 10 },  // Duration
  { wch: 22 },  // Setters
  { wch: 28 },  // Markers
  { wch: 18 },  // Classes
  ...Array.from({ length: 10 }, () => ({ wch: 5 })), // 1..10
  { wch: 8 },   // Total
  { wch: 36 },  // Remarks
];

// Merge title across the whole header width
ws["!merges"] = [
  { s: { r: 0, c: 0 }, e: { r: 0, c: HEADERS.length - 1 } },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Deployment");

const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);
