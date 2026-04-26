// 5086 v3 ingestion — Chemistry_Dataset_mod-3.xlsx
// =========================================================================
// Source:  /tmp/ds3.xlsx  (sheets: AO, Chem LO, Physics LO, Format)
// Target:  Combined Science 5086 syllabus document (DOC_ID below)
//
// What this script emits (single SQL transaction):
//   1. Wipe all existing 5086 topics, AOs, topic↔paper links, Biology paper.
//   2. Re-insert Physics topics from tab "5086 Learning Outcomes (Physics".
//   3. Re-insert Chemistry topics from tab "5086 Learning Outcomes (Chem)".
//   4. Re-insert AO definitions A1..A5 / B1..B7 / C1..C6 from "AO" tab.
//   5. Insert 6 synthetic Practical-skill topics (C1..C6) for Paper 5.
//   6. Wire syllabus_topic_papers:
//         Paper 1 (MCQ)        → all Physics + Chemistry topics
//         Paper 2 (Physics)    → Physics topics only
//         Paper 3 (Chemistry)  → Chemistry topics only
//         Paper 5 (Practical)  → Physics + Chemistry topics + 6 skill anchors
//   7. Auto-tag each topic with granular AO codes inferred from LO verbs.
//
// Output:  prints SQL to stdout → save as /tmp/ingest_5086_v3.sql
//
// NOTE: 5086 = Physics + Chemistry only (XLSX Format sheet, line 16).
//       We delete Paper 4 (Biology) and all Biology topics.

import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

const DOC_ID    = "65010473-aa3d-4566-80c9-303540a5add2";
const PAPER1_ID = "29c6db50-5822-4479-94f4-d4ea16bcefc0"; // MCQ      (Phys+Chem)
const PAPER2_ID = "0cf1efb6-49f1-4f6a-a3e3-14b6a085cc62"; // Physics
const PAPER3_ID = "59a2bebd-ce09-4581-8494-e7b03e16d3ac"; // Chemistry
const PAPER4_ID = "18768928-131a-45ac-8191-aa1646c374f2"; // Biology  (DELETE)
const PAPER5_ID = "127d441f-1fea-4c14-80b2-a1a3ed86726f"; // Practical(Phys+Chem)

const buf = await readFile("/tmp/ds3.xlsx");
const wb  = XLSX.read(buf, { type: "buffer" });

const sql = [];
const q   = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (a) => `ARRAY[${a.map(q).join(",")}]::text[]`;

// ─── AO inference (Combined Sci AO grid: A1-5, B1-7, C1-6) ────────────────
function inferAOs(text, isPractical = false) {
  const t = ` ${String(text).toLowerCase()} `;
  const out = new Set();
  if (isPractical) {
    if (/\b(follow|sequence|instruction|procedure|step)\b/.test(t)) out.add("C1");
    if (/\b(use|apparatus|technique|material|equipment|set up)\b/.test(t)) out.add("C2");
    if (/\b(record|observe|measure|estimate|reading)\b/.test(t)) out.add("C3");
    if (/\b(interpret|evaluate|result|observation|analyse|analyze)\b/.test(t)) out.add("C4");
    if (/\b(plan|design|select.*technique|investigation)\b/.test(t)) out.add("C5");
    if (/\b(improve|modify|extension|suggest.*method|limitation|error)\b/.test(t)) out.add("C6");
    if (out.size === 0) { out.add("C1"); out.add("C3"); }
    return [...out];
  }
  if (/\b(define|state|name|describe|explain|outline|recall|phenomena|law|theory|concept)\b/.test(t)) out.add("A1");
  if (/\b(symbol|formula|notation|unit|terminology|vocabulary|nuclide|convention|equation)\b/.test(t)) out.add("A2");
  if (/\b(apparatus|burette|pipette|cylinder|syringe|technique|safety|instrument|thermometer|balance|ammeter|voltmeter)\b/.test(t)) out.add("A3");
  if (/\b(mass|volume|temperature|concentration|determine|measure|quantity|rate|energy|force|speed|velocity|acceleration|current|voltage|resistance)\b/.test(t)) out.add("A4");
  if (/\b(application|social|economic|environmental|industrial|fuel|pollution|atmosphere|alloy|polymer|household|safety device|domestic)\b/.test(t)) out.add("A5");
  if (/\b(locate|select|organise|organize|present|from the|given|information)\b/.test(t)) out.add("B1");
  if (/\b(translate|interpret|convert|graph|chart|table|diagram|sketch|plot)\b/.test(t)) out.add("B2");
  if (/\b(calculate|manipulate|compute|stoichiometr|moles of|mol\/dm|numerical)\b/.test(t)) out.add("B3");
  if (/\b(identify|trend|pattern|infer|deduce|compare)\b/.test(t)) out.add("B4");
  if (/\b(explain|account for|reasoned|relationship|in terms of|why)\b/.test(t)) out.add("B5");
  if (/\b(predict|propose|hypothesis|hypothesise|hypothesize|suggest)\b/.test(t)) out.add("B6");
  if (/\b(solve|problem|find|determine the)\b/.test(t)) out.add("B7");
  if (out.size === 0) { out.add("A1"); out.add("B5"); }
  return [...out];
}

// ─── Helpers to group LOs by topic_code (first 2 segments) ────────────────
function groupRows(sheetName, sectionLabel, fixups = (r) => r) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 }).slice(1);
  const groups = new Map(); // topic_code -> { strand, title, los: [{code,text}] }
  for (let raw of rows) {
    if (!raw || !raw[0]) continue;
    const r = fixups({
      loCode: String(raw[0]).trim(),
      strand: String(raw[1] ?? "").trim(),
      title:  String(raw[2] ?? "").trim(),
      text:   String(raw[3] ?? "").trim(),
    });
    if (!r) continue;
    const segs = r.loCode.split(".");
    const topicCode = segs.length >= 3 ? `${segs[0]}.${segs[1]}` : segs.slice(0, -1).join(".") || segs[0];
    if (!groups.has(topicCode)) groups.set(topicCode, { strand: r.strand, title: r.title, los: [], section: sectionLabel });
    groups.get(topicCode).los.push({ code: r.loCode, text: r.text });
  }
  return groups;
}

// Physics fixups: XLSX has known typos
//   - rows under topic "Radioactivity" reuse codes 11.1.1..11.3.1 (collide w/ Light)
//     → rebrand to 16.x because Radioactivity is the 16th Physics topic
//   - rows 15.2-15.5 are misfiled under strand "Electromagnetic Spectrum"
//     but actually belong to "Magnetism and Electromagnetism"
function physFix(r) {
  if (r.strand === "Radioactivity") {
    const rest = r.loCode.replace(/^11\./, "");
    r.loCode = `16.${rest}`;
  }
  if (r.loCode.startsWith("15.") && r.strand === "Electromagnetic Spectrum") {
    r.strand = "Magnetism and Electromagnetism";
  }
  return r;
}

const physGroups = groupRows("5086 Learning Outcomes (Physics", "Physics", physFix);
const chemGroups = groupRows("5086 Learning Outcomes (Chem)",   "Chemistry");

// ─── AO definitions tab ────────────────────────────────────────────────────
const aoRows = XLSX.utils.sheet_to_json(wb.Sheets["Assessment Outcome (AO)"], { header: 1 }).slice(1);
const aoDefs = []; // {code, title, description}
for (const r of aoRows) {
  if (!r || !r[0]) continue;
  const code = `${String(r[0]).trim()}${r[2] ?? ""}`.trim(); // e.g. "A" + 1 = "A1"
  const title = String(r[1] ?? "").trim();
  const desc = String(r[3] ?? "").trim();
  aoDefs.push({ code, title, description: desc });
}

// ═══════════════════════════════════════════════════════════════════════════
// SQL EMISSION
// ═══════════════════════════════════════════════════════════════════════════
sql.push(`-- ═════════ 5086 v3 refresh from Chemistry_Dataset_mod-3.xlsx ═════════`);
sql.push(`-- Drop existing Biology paper + all 5086 topics + AOs + links`);
sql.push(`DELETE FROM public.syllabus_topic_papers WHERE topic_id IN (SELECT id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)});`);
sql.push(`DELETE FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)};`);
sql.push(`DELETE FROM public.syllabus_assessment_objectives WHERE source_doc_id=${q(DOC_ID)};`);
sql.push(`DELETE FROM public.syllabus_papers WHERE id=${q(PAPER4_ID)};`);
sql.push(``);

// ─── Insert topics ─────────────────────────────────────────────────────────
function emitTopics(groups, section, posBase) {
  let pos = posBase;
  for (const [topicCode, g] of [...groups.entries()].sort((a, b) => natCmp(a[0], b[0]))) {
    const los = g.los.map((l) => l.text);
    const aoSet = new Set();
    for (const l of g.los) inferAOs(l.text).forEach((a) => aoSet.add(a));
    sql.push(
      `INSERT INTO public.syllabus_topics ` +
      `(source_doc_id, paper_id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcomes, suggested_blooms, outcome_categories, ao_codes, section, subject, level) ` +
      `VALUES (${q(DOC_ID)}, NULL, ${q(topicCode)}, NULL, ${q(g.title)}, 1, ${pos}, ${q(g.strand)}, ${q(g.title)}, ` +
      `${arr(los)}, ${arr([])}, ${arr([])}, ${arr([...aoSet])}, ${q(section)}, ${q(section)}, ${q("O-Level")});`,
    );
    pos++;
  }
  return pos;
}
function natCmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

sql.push(`-- ─── Physics topics (Paper 2 owns; Papers 1 + 5 share via join) ───`);
let nextPos = emitTopics(physGroups, "Physics", 100);
sql.push(``);
sql.push(`-- ─── Chemistry topics (Paper 3 owns; Papers 1 + 5 share via join) ───`);
nextPos = emitTopics(chemGroups, "Chemistry", nextPos);
sql.push(``);

// ─── Practical-skill anchor topics (one per C1..C6) ────────────────────────
sql.push(`-- ─── Synthetic Practical-skill anchors for Paper 5 ───`);
const practicalSkills = [
  ["C1", "Following instructions",      "Follow a sequence of instructions"],
  ["C2", "Using apparatus",             "Use techniques, apparatus and materials"],
  ["C3", "Recording observations",      "Make and record observations, measurements and estimates"],
  ["C4", "Interpreting results",        "Interpret and evaluate observations and experimental results"],
  ["C5", "Planning investigations",     "Plan investigations, select techniques, apparatus and materials"],
  ["C6", "Evaluating methods",          "Evaluate methods and suggest improvements"],
];
for (const [code, title, lo] of practicalSkills) {
  sql.push(
    `INSERT INTO public.syllabus_topics ` +
    `(source_doc_id, paper_id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcomes, suggested_blooms, outcome_categories, ao_codes, section, subject, level) ` +
    `VALUES (${q(DOC_ID)}, ${q(PAPER5_ID)}, ${q(`P5.${code}`)}, NULL, ${q(title)}, 1, ${nextPos}, ${q("Experimental Skills")}, ${q(title)}, ` +
    `${arr([lo])}, ${arr([])}, ${arr([])}, ${arr([code])}, ${q("Practical")}, ${q("Practical")}, ${q("O-Level")});`,
  );
  nextPos++;
}
sql.push(``);

// ─── AO definitions ────────────────────────────────────────────────────────
sql.push(`-- ─── AO definitions A1..A5 / B1..B7 / C1..C6 ───`);
let aoPos = 0;
for (const ao of aoDefs) {
  // Theory AOs (A*, B*) → not bound to a single paper (apply to 1/2/3); C* → Paper 5.
  const paperId = ao.code.startsWith("C") ? PAPER5_ID : null;
  sql.push(
    `INSERT INTO public.syllabus_assessment_objectives ` +
    `(source_doc_id, paper_id, code, title, description, weighting_percent, position) ` +
    `VALUES (${q(DOC_ID)}, ${paperId ? q(paperId) : "NULL"}, ${q(ao.code)}, ${q(ao.title)}, ${q(ao.description)}, NULL, ${aoPos++});`,
  );
}
sql.push(``);

// ─── Wire syllabus_topic_papers ────────────────────────────────────────────
sql.push(`-- ─── Wire topic↔paper join: Paper 1 (MCQ) and Paper 5 share Phys+Chem ───`);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (paper_id, topic_id) ` +
  `SELECT ${q(PAPER1_ID)}, id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section IN ('Physics','Chemistry') ON CONFLICT DO NOTHING;`,
);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (paper_id, topic_id) ` +
  `SELECT ${q(PAPER2_ID)}, id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section='Physics' ON CONFLICT DO NOTHING;`,
);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (paper_id, topic_id) ` +
  `SELECT ${q(PAPER3_ID)}, id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section='Chemistry' ON CONFLICT DO NOTHING;`,
);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (paper_id, topic_id) ` +
  `SELECT ${q(PAPER5_ID)}, id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section IN ('Physics','Chemistry','Practical') ON CONFLICT DO NOTHING;`,
);

console.log(sql.join("\n"));
