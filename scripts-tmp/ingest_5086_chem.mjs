// Generate SQL to ingest the 5086 Chemistry XLSX dataset into the existing
// 5086 syllabus_documents row (id 65010473-aa3d-4566-80c9-303540a5add2).
//
// Emits two SQL blobs to stdout:
//   1. INSERT/UPDATE for syllabus_assessment_objectives (granular A1..C6).
//   2. UPDATE per Chemistry topic row to attach LO codes + granular AO codes
//      + canonical LO sentences from the XLSX.
//
// Run:  node scripts-tmp/ingest_5086_chem.mjs > /tmp/ingest_5086.sql
// Then pipe to the supabase--insert tool.

import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

const DOC_ID = "65010473-aa3d-4566-80c9-303540a5add2";
const FILE = "/tmp/chem.xlsx";

const buf = await readFile(FILE);
const wb = XLSX.read(buf, { type: "buffer" });

// ─── Sheet 1: AOs ──────────────────────────────────────────────────────────
const aoRows = XLSX.utils.sheet_to_json(wb.Sheets["Assessment Outcome (AO)"], { header: 1 }).slice(1);
// rows: [Category(letter), Category(name), ObjectiveNo, Description, CommandWords]

function aoWeight(letter) {
  if (letter === "A" || letter === "B") return 50; // theory: ~50% each
  return 100; // C is 100% of practical paper
}

const aoInserts = [];
let pos = 100; // start after legacy letter rows so existing UI keeps working
for (const r of aoRows) {
  if (!r || !r[0]) continue;
  const letter = String(r[0]).trim();
  const name = String(r[1] ?? "").trim();
  const num = String(r[2] ?? "").trim();
  const desc = String(r[3] ?? "").trim().replace(/'/g, "''");
  const cmd = String(r[4] ?? "").trim();
  const code = `${letter}${num}`;
  const title = name; // group title (e.g. "Knowledge with Understanding")
  const fullDesc = cmd && cmd !== "-" ? `${desc} | Command words: ${cmd}` : desc;
  aoInserts.push(
    `('${DOC_ID}', '${code}', '${title.replace(/'/g, "''")}', '${fullDesc.replace(/'/g, "''")}', ${aoWeight(letter)}, ${pos++})`,
  );
}

console.log(`-- 1. Granular AOs (A1..C6) for 5086`);
console.log(`DELETE FROM public.syllabus_assessment_objectives`);
console.log(`  WHERE source_doc_id = '${DOC_ID}' AND code ~ '^[ABC][0-9]+$';`);
console.log(`INSERT INTO public.syllabus_assessment_objectives`);
console.log(`  (source_doc_id, code, title, description, weighting_percent, position) VALUES`);
console.log(aoInserts.join(",\n") + ";");
console.log();

// ─── Sheet 2: LOs ──────────────────────────────────────────────────────────
const loRows = XLSX.utils.sheet_to_json(wb.Sheets["5086 KOs Learning Outcomes LOs"], { header: 1 }).slice(1);
// rows: [LO Code, Topic, Content, LO]

// Group by (Topic, Content) → topic_code is the first two segments of LO code
// (e.g. 1.1.1 → 1.1, 5.1.1 → 5.1, 6.1.1 → 6.1).
const groups = new Map(); // key topic_code → { strand, title, los: [{code, text}] }
for (const r of loRows) {
  if (!r || !r[0]) continue;
  const loCode = String(r[0]).trim();
  const strand = String(r[1] ?? "").trim();
  const title = String(r[2] ?? "").trim();
  const text = String(r[3] ?? "").trim();
  const segs = loCode.split(".");
  // topic_code: keep first two segments if there are 3+, else everything except last.
  const topicCode = segs.length >= 3 ? `${segs[0]}.${segs[1]}` : segs.slice(0, -1).join(".") || segs[0];
  if (!groups.has(topicCode)) groups.set(topicCode, { strand, title, los: [] });
  groups.get(topicCode).los.push({ code: loCode, text });
}

// Granular AO inference from command words found in the LO sentence.
function inferAOs(text) {
  const t = ` ${text.toLowerCase()} `;
  const out = new Set();
  // A series — Knowledge with Understanding
  if (/\b(define|state|name|describe|explain|outline)\b/.test(t)) out.add("A1");
  if (/\b(symbol|formula|notation|unit|terminology|vocabulary|nuclide)\b/.test(t)) out.add("A2");
  if (/\b(apparatus|burette|pipette|cylinder|syringe|technique|safety|instrument)\b/.test(t)) out.add("A3");
  if (/\b(quantity|mass|volume|temperature|concentration|determine|measure)\b/.test(t)) out.add("A4");
  if (/\b(application|social|economic|environmental|industrial|fuel|pollution|atmosphere)\b/.test(t)) out.add("A5");
  // B series — Handling Information & Solving Problems
  if (/\b(locate|select|organise|present)\b/.test(t)) out.add("B1");
  if (/\b(translate|interpret|convert|graph|chart|table)\b/.test(t)) out.add("B2");
  if (/\b(calculate|manipulate|compute|stoichiometr)\b/.test(t)) out.add("B3");
  if (/\b(identify|trend|pattern|infer|deduce)\b/.test(t)) out.add("B4");
  if (/\b(explain|account for|reasoned|relationship)\b/.test(t)) out.add("B5");
  if (/\b(predict|propose|hypothesis|hypothesise|suggest)\b/.test(t)) out.add("B6");
  if (/\b(solve|problem)\b/.test(t)) out.add("B7");
  if (out.size === 0) { out.add("A1"); out.add("B5"); }
  return Array.from(out);
}

function pgArray(arr) {
  return `ARRAY[${arr.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(",")}]::text[]`;
}

console.log(`-- 2. Refresh Chemistry topics with LO codes + granular AO codes`);
for (const [topicCode, g] of groups.entries()) {
  // Aggregate AO codes across LOs in the group
  const aoSet = new Set();
  g.los.forEach((lo) => inferAOs(lo.text).forEach((c) => aoSet.add(c)));
  // Sort LOs by code numerically
  g.los.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const loSentences = g.los.map((lo) => lo.text);
  const firstLoCode = g.los[0]?.code ?? "";
  const titleSafe = g.title.replace(/'/g, "''");
  const strandSafe = g.strand.replace(/'/g, "''");

  console.log(
    `UPDATE public.syllabus_topics SET ` +
      `title='${titleSafe}', ` +
      `strand='${strandSafe}', ` +
      `learning_outcome_code='${firstLoCode}', ` +
      `learning_outcomes=${pgArray(loSentences)}, ` +
      `ao_codes=${pgArray(Array.from(aoSet).sort())}, ` +
      `updated_at=now() ` +
      `WHERE source_doc_id='${DOC_ID}' AND section='Chemistry' AND topic_code='${topicCode}';`,
  );
}

console.log();
console.log(`-- 3. Annotate syllabus_documents notes with format summary`);
console.log(
  `UPDATE public.syllabus_documents SET notes = COALESCE(notes,'') || ` +
    `E'\n\n[5086 Format] AO weighting: A ≈ 50%, B ≈ 50% (theory papers); C = 100% (Paper 5 practical). ` +
    `Candidates take Paper 1 (MCQ, all sciences), Paper 5 (Practical), and TWO of Papers 2 (Physics), 3 (Chemistry), 4 (Biology).' ` +
    `WHERE id='${DOC_ID}';`,
);
