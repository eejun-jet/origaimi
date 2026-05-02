// Combined Science 5086/5087/5088 — refresh topics, AOs, and paper wiring
// from Chemistry_Dataset_1.xlsx (Format / AO / 5086 LO Chem / Physics / Biology).
//
// Run:  node scripts-tmp/ingest_combined_sci.mjs > /tmp/ingest_cs.sql
// Then pipe to supabase--insert.

import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

const DOC_ID    = "8df0320d-dd0a-4ffb-80a0-66b6e831345f";
const PAPER1_ID = "91cdc25a-037f-4c6b-8826-4d8a38e247ca"; // MCQ (all)
const PAPER2_ID = "a24e6a3e-883c-4fdf-bbdb-8056ca6567b5"; // Physics
const PAPER3_ID = "c280b416-bf6c-4d73-9cd1-cc93c7b68b27"; // Chemistry
const PAPER4_ID = "a4d2588c-f5d9-4cc7-a96c-f879ae121b40"; // Biology
const PAPER5_ID = "f56f5968-7edf-41b7-b023-3520916b8671"; // Practical

const buf = await readFile("/tmp/ds.xlsx");
const wb  = XLSX.read(buf, { type: "buffer" });
const sql = [];
const q   = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (a) => `ARRAY[${a.map(q).join(",")}]::text[]`;

// ── AO inference from LO verb cues ────────────────────────────────────────
function inferAOs(text) {
  const t = ` ${String(text).toLowerCase()} `;
  const out = new Set();
  if (/\b(define|state|name|describe|explain|outline|recall|phenomena|law|theory|concept|identify|show an understanding)\b/.test(t)) out.add("A1");
  if (/\b(symbol|formula|notation|unit|terminology|vocabulary|nuclide|convention|equation)\b/.test(t)) out.add("A2");
  if (/\b(apparatus|burette|pipette|cylinder|syringe|technique|safety|instrument|thermometer|balance|ammeter|voltmeter|microscope|micrograph)\b/.test(t)) out.add("A3");
  if (/\b(mass|volume|temperature|concentration|determine|measure|quantity|rate|energy|force|speed|velocity|acceleration|current|voltage|resistance|magnitude)\b/.test(t)) out.add("A4");
  if (/\b(application|social|economic|environmental|industrial|fuel|pollution|atmosphere|alloy|polymer|household|domestic|medical|disease|impact)\b/.test(t)) out.add("A5");
  if (/\b(locate|select|organise|organize|present|from the|given|information|sources)\b/.test(t)) out.add("B1");
  if (/\b(translate|interpret|convert|graph|chart|table|diagram|sketch|plot)\b/.test(t)) out.add("B2");
  if (/\b(calculate|manipulate|compute|stoichiometr|moles of|mol\/dm|numerical)\b/.test(t)) out.add("B3");
  if (/\b(trend|pattern|infer|deduce|compare|distinguish)\b/.test(t)) out.add("B4");
  if (/\b(explain|account for|reasoned|relationship|in terms of|why)\b/.test(t)) out.add("B5");
  if (/\b(predict|propose|hypothesis|hypothesise|hypothesize|suggest)\b/.test(t)) out.add("B6");
  if (/\b(solve|problem|find|determine the)\b/.test(t)) out.add("B7");
  if (out.size === 0) { out.add("A1"); out.add("B5"); }
  return [...out];
}

// ── Group LOs by (KO topic, Content) ──────────────────────────────────────
// LO Code format: <topic>.<sub>.<seq>  e.g. 1.1.1 — group by first 2 segments.
function groupSheet(sheetName, sectionLabel) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 }).slice(1);
  const groups = new Map(); // topicCode -> { ko, content, los: [{code,text}] }
  for (const r of rows) {
    if (!r || !r[0]) continue;
    const loCode = String(r[0]).trim();
    const ko = String(r[1] ?? "").trim();
    const content = String(r[2] ?? "").trim();
    const text = String(r[3] ?? "").trim();
    if (!loCode || !text) continue;
    const segs = loCode.split(".");
    const topicCode = segs.length >= 3 ? `${segs[0]}.${segs[1]}` : segs.slice(0, -1).join(".") || segs[0];
    if (!groups.has(topicCode)) groups.set(topicCode, { ko, content, los: [], section: sectionLabel });
    groups.get(topicCode).los.push({ code: loCode, text });
  }
  return groups;
}

const physGroups = groupSheet("5086 Learning Outcomes (Physics", "Physics");
const chemGroups = groupSheet("5086 Learning Outcomes (Chem)",   "Chemistry");
const bioGroups  = groupSheet(" 5086 Learning Outcomes (Biolog", "Biology");

// ── AO definitions from "AO" sheet ────────────────────────────────────────
const aoRows = XLSX.utils.sheet_to_json(wb.Sheets["AO"], { header: 1 }).slice(1);
const aoDefs = [];
for (const r of aoRows) {
  if (!r || !r[0]) continue;
  const cat = String(r[0]).trim();         // A | B | C
  const catName = String(r[1] ?? "").trim();
  const num = String(r[2] ?? "").trim();
  const desc = String(r[3] ?? "").trim();
  const cmd = String(r[4] ?? "").trim();
  const code = `${cat}${num}`;
  const fullDesc = cmd && cmd !== "-" ? `${desc} | Command words: ${cmd}` : desc;
  aoDefs.push({ code, title: catName, description: fullDesc });
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

// ═════════ SQL ═════════
sql.push(`-- Combined Science 5086/5087/5088 — full refresh from Chemistry_Dataset_1.xlsx`);
sql.push(`BEGIN;`);
sql.push(`DELETE FROM public.syllabus_topic_papers WHERE topic_id IN (SELECT id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)});`);
sql.push(`DELETE FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)};`);
sql.push(`DELETE FROM public.syllabus_assessment_objectives WHERE source_doc_id=${q(DOC_ID)};`);
sql.push(``);

// ── Topics ────────────────────────────────────────────────────────────────
function emitTopics(groups, section, posStart) {
  let pos = posStart;
  for (const [topicCode, g] of [...groups.entries()].sort((a, b) => natCmp(a[0], b[0]))) {
    const los = g.los.map((l) => l.text);
    const aoSet = new Set();
    for (const l of g.los) inferAOs(l.text).forEach((a) => aoSet.add(a));
    const firstLoCode = g.los[0]?.code ?? "";
    sql.push(
      `INSERT INTO public.syllabus_topics ` +
      `(source_doc_id, paper_id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcome_code, learning_outcomes, suggested_blooms, outcome_categories, ao_codes, section, subject, level) VALUES (` +
      `${q(DOC_ID)}, NULL, ${q(topicCode)}, NULL, ${q(g.content || g.ko)}, 1, ${pos}, ${q(g.ko)}, ${q(g.content)}, ${q(firstLoCode)}, ` +
      `${arr(los)}, ${arr([])}, ${arr([])}, ${arr([...aoSet].sort())}, ${q(section)}, ${q(section)}, ${q("Sec 4")});`,
    );
    pos++;
  }
  return pos;
}

let pos = 100;
sql.push(`-- Physics topics (Paper 2 owns; Papers 1 + 5 share via join)`);
pos = emitTopics(physGroups, "Physics", pos);
sql.push(`-- Chemistry topics (Paper 3 owns; Papers 1 + 5 share via join)`);
pos = emitTopics(chemGroups, "Chemistry", pos);
sql.push(`-- Biology topics (Paper 4 owns; Papers 1 + 5 share via join)`);
pos = emitTopics(bioGroups, "Biology", pos);
sql.push(``);

// ── Practical-skill anchors (one per C1..C6) for Paper 5 ──────────────────
sql.push(`-- Synthetic Practical-skill anchors for Paper 5`);
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
    `(source_doc_id, paper_id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcome_code, learning_outcomes, suggested_blooms, outcome_categories, ao_codes, section, subject, level) VALUES (` +
    `${q(DOC_ID)}, ${q(PAPER5_ID)}, ${q(`P5.${code}`)}, NULL, ${q(title)}, 1, ${pos}, ${q("Experimental Skills and Investigations")}, ${q(title)}, ${q(code)}, ` +
    `${arr([lo])}, ${arr([])}, ${arr([])}, ${arr([code])}, ${q("Practical")}, ${q("Practical")}, ${q("Sec 4")});`,
  );
  pos++;
}
sql.push(``);

// ── AO definitions ────────────────────────────────────────────────────────
sql.push(`-- AO definitions A1..A5, B1..B7, C1..C6`);
let aoPos = 0;
for (const ao of aoDefs) {
  const paperId = ao.code.startsWith("C") ? PAPER5_ID : null; // C* bound to Paper 5
  sql.push(
    `INSERT INTO public.syllabus_assessment_objectives ` +
    `(source_doc_id, paper_id, code, title, description, weighting_percent, position) VALUES (` +
    `${q(DOC_ID)}, ${paperId ? q(paperId) : "NULL"}, ${q(ao.code)}, ${q(ao.title)}, ${q(ao.description)}, NULL, ${aoPos++});`,
  );
}
sql.push(``);

// ── Wire syllabus_topic_papers ────────────────────────────────────────────
// Paper 1 (MCQ) — ALL Phys+Chem+Bio (per-syllabus subset chosen at builder time)
// Paper 2 — Physics; Paper 3 — Chemistry; Paper 4 — Biology
// Paper 5 — Phys + Chem + Bio + Practical anchors
sql.push(`-- Wire topic↔paper pools`);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (paper_id, topic_id) ` +
  `SELECT ${q(PAPER1_ID)}, id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section IN ('Physics','Chemistry','Biology') ON CONFLICT DO NOTHING;`,
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
  `SELECT ${q(PAPER4_ID)}, id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section='Biology' ON CONFLICT DO NOTHING;`,
);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (paper_id, topic_id) ` +
  `SELECT ${q(PAPER5_ID)}, id FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section IN ('Physics','Chemistry','Biology','Practical') ON CONFLICT DO NOTHING;`,
);
sql.push(``);

// ── Update Paper rows with correct format details from Format sheet ───────
sql.push(`-- Refresh paper format metadata (durations, marks, weighting, sections)`);
sql.push(`UPDATE public.syllabus_papers SET marks=40, weighting_percent=20, duration_minutes=60, component_name='Multiple Choice', track_tags=ARRAY['physics','chemistry','biology']::text[] WHERE id=${q(PAPER1_ID)};`);
sql.push(`UPDATE public.syllabus_papers SET marks=65, weighting_percent=33, duration_minutes=75, component_name='Structured and Free Response (Physics)', section='Physics', track_tags=ARRAY['physics']::text[] WHERE id=${q(PAPER2_ID)};`);
sql.push(`UPDATE public.syllabus_papers SET marks=65, weighting_percent=33, duration_minutes=75, component_name='Structured and Free Response (Chemistry)', section='Chemistry', track_tags=ARRAY['chemistry']::text[] WHERE id=${q(PAPER3_ID)};`);
sql.push(`UPDATE public.syllabus_papers SET marks=65, weighting_percent=33, duration_minutes=75, component_name='Structured and Free Response (Biology)', section='Biology', track_tags=ARRAY['biology']::text[] WHERE id=${q(PAPER4_ID)};`);
sql.push(`UPDATE public.syllabus_papers SET marks=30, weighting_percent=15, duration_minutes=90, component_name='Practical Test', track_tags=ARRAY['physics','chemistry','biology']::text[] WHERE id=${q(PAPER5_ID)};`);
sql.push(``);

sql.push(`-- Annotate doc with format summary`);
sql.push(
  `UPDATE public.syllabus_documents SET notes = ` +
  `E'[5086 / 5087 / 5088 Format]\\n` +
  `Theory papers (1, 2, 3, 4): AO A ≈ 50% (recall ≈ 20%), AO B ≈ 50%.\\n` +
  `Practical paper (5): AO C, Experimental Skills and Investigations.\\n` +
  `Candidates take Paper 1 (MCQ, common), Paper 5 (Practical, common), and TWO of Papers 2 (Physics) / 3 (Chemistry) / 4 (Biology).\\n` +
  `5086 = Physics + Chemistry; 5087 = Physics + Biology; 5088 = Chemistry + Biology.' ` +
  `WHERE id=${q(DOC_ID)};`,
);
sql.push(``);
sql.push(`COMMIT;`);
console.log(sql.join("\n"));
