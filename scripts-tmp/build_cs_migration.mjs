// Compact ingestion: build a single migration whose payload is a JSON
// literal embedded in a DO $$ block. The PL/pgSQL block iterates rows and
// performs the inserts/updates. This keeps the migration ~50% smaller than
// per-row INSERT statements and makes reading/auditing tractable.

import { readFile, writeFile } from "node:fs/promises";
import * as XLSX from "xlsx";

const DOC_ID    = "8df0320d-dd0a-4ffb-80a0-66b6e831345f";
const PAPER1_ID = "91cdc25a-037f-4c6b-8826-4d8a38e247ca";
const PAPER2_ID = "a24e6a3e-883c-4fdf-bbdb-8056ca6567b5";
const PAPER3_ID = "c280b416-bf6c-4d73-9cd1-cc93c7b68b27";
const PAPER4_ID = "a4d2588c-f5d9-4cc7-a96c-f879ae121b40";
const PAPER5_ID = "f56f5968-7edf-41b7-b023-3520916b8671";

const wb = XLSX.read(await readFile("/tmp/ds.xlsx"), { type: "buffer" });

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
  return [...out].sort();
}

function groupSheet(sheetName, sectionLabel) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 }).slice(1);
  const groups = new Map();
  for (const r of rows) {
    if (!r || !r[0]) continue;
    const loCode = String(r[0]).trim();
    const ko = String(r[1] ?? "").trim();
    const content = String(r[2] ?? "").trim();
    const text = String(r[3] ?? "").trim();
    if (!text) continue;
    const segs = loCode.split(".");
    const topicCode = segs.length >= 3 ? `${segs[0]}.${segs[1]}` : segs.slice(0, -1).join(".") || segs[0];
    if (!groups.has(topicCode)) groups.set(topicCode, { topic_code: topicCode, ko, content, los: [], section: sectionLabel });
    groups.get(topicCode).los.push({ code: loCode, text });
  }
  return groups;
}
const all = [
  ...[...groupSheet("5086 Learning Outcomes (Physics", "Physics").values()],
  ...[...groupSheet("5086 Learning Outcomes (Chem)", "Chemistry").values()],
  ...[...groupSheet(" 5086 Learning Outcomes (Biolog", "Biology").values()],
];
function natCmp(a, b) {
  const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0; if (x !== y) return x - y;
  }
  return 0;
}
// Sort within each section by topic_code numerically
const bySection = { Physics: [], Chemistry: [], Biology: [] };
for (const g of all) bySection[g.section].push(g);
for (const k of Object.keys(bySection)) bySection[k].sort((a, b) => natCmp(a.topic_code, b.topic_code));

let pos = 100;
const topics = [];
for (const sec of ["Physics", "Chemistry", "Biology"]) {
  for (const g of bySection[sec]) {
    const aoSet = new Set();
    for (const l of g.los) inferAOs(l.text).forEach((a) => aoSet.add(a));
    topics.push({
      tc: g.topic_code,
      ti: g.content || g.ko,
      st: g.ko,
      ss: g.content,
      lc: g.los[0].code,
      lo: g.los.map((l) => l.text),
      ao: [...aoSet].sort(),
      se: sec,
      pos: pos++,
    });
  }
}
// Practical anchors
const skills = [
  ["C1", "Following instructions",  "Follow a sequence of instructions"],
  ["C2", "Using apparatus",         "Use techniques, apparatus and materials"],
  ["C3", "Recording observations",  "Make and record observations, measurements and estimates"],
  ["C4", "Interpreting results",    "Interpret and evaluate observations and experimental results"],
  ["C5", "Planning investigations", "Plan investigations, select techniques, apparatus and materials"],
  ["C6", "Evaluating methods",      "Evaluate methods and suggest improvements"],
];
for (const [code, title, lo] of skills) {
  topics.push({
    tc: `P5.${code}`, ti: title, st: "Experimental Skills and Investigations", ss: title, lc: code,
    lo: [lo], ao: [code], se: "Practical", pos: pos++, p5: true,
  });
}

// AOs from XLSX
const aoRows = XLSX.utils.sheet_to_json(wb.Sheets["AO"], { header: 1 }).slice(1);
const aos = [];
let aoPos = 0;
for (const r of aoRows) {
  if (!r || !r[0]) continue;
  const cat = String(r[0]).trim();
  const catName = String(r[1] ?? "").trim();
  const num = String(r[2] ?? "").trim();
  const desc = String(r[3] ?? "").trim();
  const cmd = String(r[4] ?? "").trim();
  const code = `${cat}${num}`;
  const fullDesc = cmd && cmd !== "-" ? `${desc} | Command words: ${cmd}` : desc;
  aos.push({ code, title: catName, desc: fullDesc, pos: aoPos++ });
}

const payload = { doc_id: DOC_ID, paper5_id: PAPER5_ID, topics, aos };

// Build the migration body
const migration = `-- Combined Science 5086/5087/5088 — refresh KO/LO topics + granular AOs from
-- Chemistry_Dataset_1.xlsx. Drives the assessment coach so it follows the
-- syllabus framers' KO + LO mapping when generating questions and reviewing
-- coverage (the coach reads syllabus_topics.learning_outcomes / ao_codes
-- directly via loadPaperTopics → generate-assessment + coach-review).

DO $mig$
DECLARE
  v public.syllabus_topics%ROWTYPE;
  rec jsonb;
  payload jsonb := $$${JSON.stringify(payload)}$$::jsonb;
  doc_id uuid := (payload->>'doc_id')::uuid;
  paper5_id uuid := (payload->>'paper5_id')::uuid;
BEGIN
  -- Wipe existing combined-science topics, AOs, and topic↔paper join rows
  DELETE FROM public.syllabus_topic_papers
   WHERE topic_id IN (SELECT id FROM public.syllabus_topics WHERE source_doc_id = doc_id);
  DELETE FROM public.syllabus_topics WHERE source_doc_id = doc_id;
  DELETE FROM public.syllabus_assessment_objectives WHERE source_doc_id = doc_id;

  -- Insert topics
  FOR rec IN SELECT * FROM jsonb_array_elements(payload->'topics')
  LOOP
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title, depth, position,
       strand, sub_strand, learning_outcome_code, learning_outcomes,
       suggested_blooms, outcome_categories, ao_codes, section, subject, level)
    VALUES (
      doc_id,
      CASE WHEN (rec->>'p5')::boolean THEN paper5_id ELSE NULL END,
      rec->>'tc', NULL, rec->>'ti', 1, (rec->>'pos')::int,
      rec->>'st', rec->>'ss', rec->>'lc',
      ARRAY(SELECT jsonb_array_elements_text(rec->'lo'))::text[],
      ARRAY[]::text[], ARRAY[]::text[],
      ARRAY(SELECT jsonb_array_elements_text(rec->'ao'))::text[],
      rec->>'se',
      rec->>'se',
      'Sec 4'
    );
  END LOOP;

  -- Insert AOs (granular A1..A5, B1..B7, C1..C6)
  FOR rec IN SELECT * FROM jsonb_array_elements(payload->'aos')
  LOOP
    INSERT INTO public.syllabus_assessment_objectives
      (source_doc_id, paper_id, code, title, description, weighting_percent, position)
    VALUES (
      doc_id,
      CASE WHEN left(rec->>'code', 1) = 'C' THEN paper5_id ELSE NULL END,
      rec->>'code', rec->>'title', rec->>'desc', NULL, (rec->>'pos')::int
    );
  END LOOP;

  -- Wire syllabus_topic_papers per the 5086/5087/5088 Format sheet:
  --   Paper 1 (MCQ, common to all 3 syllabi)  → ALL Phys + Chem + Bio topics
  --     (the per-syllabus subset is enforced at builder time via the section
  --      sub-selector)
  --   Paper 2 (Physics theory)                → Physics only
  --   Paper 3 (Chemistry theory)              → Chemistry only
  --   Paper 4 (Biology theory)                → Biology only
  --   Paper 5 (Practical, common)             → Phys + Chem + Bio + practical anchors
  INSERT INTO public.syllabus_topic_papers (paper_id, topic_id)
    SELECT '${PAPER1_ID}'::uuid, id FROM public.syllabus_topics
     WHERE source_doc_id = doc_id AND section IN ('Physics','Chemistry','Biology')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.syllabus_topic_papers (paper_id, topic_id)
    SELECT '${PAPER2_ID}'::uuid, id FROM public.syllabus_topics
     WHERE source_doc_id = doc_id AND section = 'Physics'
    ON CONFLICT DO NOTHING;
  INSERT INTO public.syllabus_topic_papers (paper_id, topic_id)
    SELECT '${PAPER3_ID}'::uuid, id FROM public.syllabus_topics
     WHERE source_doc_id = doc_id AND section = 'Chemistry'
    ON CONFLICT DO NOTHING;
  INSERT INTO public.syllabus_topic_papers (paper_id, topic_id)
    SELECT '${PAPER4_ID}'::uuid, id FROM public.syllabus_topics
     WHERE source_doc_id = doc_id AND section = 'Biology'
    ON CONFLICT DO NOTHING;
  INSERT INTO public.syllabus_topic_papers (paper_id, topic_id)
    SELECT '${PAPER5_ID}'::uuid, id FROM public.syllabus_topics
     WHERE source_doc_id = doc_id AND section IN ('Physics','Chemistry','Biology','Practical')
    ON CONFLICT DO NOTHING;
END
$mig$;

-- Refresh paper format metadata to match the Format sheet
UPDATE public.syllabus_papers SET marks=40, weighting_percent=20, duration_minutes=60,
  component_name='Multiple Choice', track_tags=ARRAY['physics','chemistry','biology']::text[]
  WHERE id='${PAPER1_ID}';
UPDATE public.syllabus_papers SET marks=65, weighting_percent=33, duration_minutes=75,
  component_name='Structured and Free Response (Physics)', section='Physics',
  track_tags=ARRAY['physics']::text[] WHERE id='${PAPER2_ID}';
UPDATE public.syllabus_papers SET marks=65, weighting_percent=33, duration_minutes=75,
  component_name='Structured and Free Response (Chemistry)', section='Chemistry',
  track_tags=ARRAY['chemistry']::text[] WHERE id='${PAPER3_ID}';
UPDATE public.syllabus_papers SET marks=65, weighting_percent=33, duration_minutes=75,
  component_name='Structured and Free Response (Biology)', section='Biology',
  track_tags=ARRAY['biology']::text[] WHERE id='${PAPER4_ID}';
UPDATE public.syllabus_papers SET marks=30, weighting_percent=15, duration_minutes=90,
  component_name='Practical Test', track_tags=ARRAY['physics','chemistry','biology']::text[]
  WHERE id='${PAPER5_ID}';

-- Annotate doc with format summary (visible in Syllabi review)
UPDATE public.syllabus_documents SET notes = E'[5086 / 5087 / 5088 Combined Science Format]\\n' ||
  E'Theory papers (1, 2, 3, 4): AO A ≈ 50% (recall ≈ 20%), AO B ≈ 50%.\\n' ||
  E'Practical paper (5): AO C, Experimental Skills and Investigations.\\n' ||
  E'Candidates take Paper 1 (MCQ, common), Paper 5 (Practical, common), and TWO of Papers 2 (Physics) / 3 (Chemistry) / 4 (Biology).\\n' ||
  E'5086 = Physics + Chemistry; 5087 = Physics + Biology; 5088 = Chemistry + Biology.'
  WHERE id='${DOC_ID}';
`;

await writeFile("/tmp/cs_migration.sql", migration);
console.log("size:", migration.length, "topics:", topics.length, "aos:", aos.length);
