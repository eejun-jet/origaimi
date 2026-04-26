// 5086 v2 ingestion — driven by Chemistry_Dataset_mod-2.xlsx + the canonical
// Format sheet inside it.
//
//   • Refreshes Chemistry topic codes / LO sentences / granular AOs
//   • Renames flat codes 5/6/7 → 5.1/6.1/7.1 and inserts new 7.2 Electrolysis
//   • Deletes orphaned 11.x / 12 (dropped from the 2025 syllabus)
//   • Deletes Biology rows (5086 = Physics + Chemistry only)
//   • Auto-tags Physics with granular A1..B7 from the command-word inference
//   • Splits Papers 2/3/4 into Section A (55m) + Section B (10m, 1-of-2)
//   • Inserts 6 synthetic "Practical skill" topics for Paper 5 (C1..C6)
//   • Links Paper 1 + Paper 5 to every Physics + Chemistry topic via the
//     new join table
//
// Output: single SQL script on stdout, ready to pipe to supabase--insert.
//   node scripts-tmp/ingest_5086_v2.mjs > /tmp/ingest_v2.sql

import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

const DOC_ID = "65010473-aa3d-4566-80c9-303540a5add2";
const PAPER1_ID = "29c6db50-5822-4479-94f4-d4ea16bcefc0";
const PAPER2_ID = "0cf1efb6-49f1-4f6a-a3e3-14b6a085cc62";
const PAPER3_ID = "59a2bebd-ce09-4581-8494-e7b03e16d3ac";
const PAPER4_ID = "18768928-131a-45ac-8191-aa1646c374f2";
const PAPER5_ID = "127d441f-1fea-4c14-80b2-a1a3ed86726f";

const FILE = "/tmp/chem2.xlsx";
const buf = await readFile(FILE);
const wb = XLSX.read(buf, { type: "buffer" });

const sql = [];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const pgArr = (a) => `ARRAY[${a.map(q).join(",")}]::text[]`;

// ─── A) Chemistry LO refresh ────────────────────────────────────────────────
const loRows = XLSX.utils.sheet_to_json(wb.Sheets["5086 KOs Learning Outcomes LOs"], { header: 1 }).slice(1);
const groups = new Map(); // topic_code → { strand, title, los }
for (const r of loRows) {
  if (!r || !r[0]) continue;
  const loCode = String(r[0]).trim();
  const strand = String(r[1] ?? "").trim();
  const title = String(r[2] ?? "").trim();
  const text = String(r[3] ?? "").trim();
  const segs = loCode.split(".");
  const topicCode = segs.length >= 3 ? `${segs[0]}.${segs[1]}` : segs.slice(0, -1).join(".") || segs[0];
  if (!groups.has(topicCode)) groups.set(topicCode, { strand, title, los: [] });
  groups.get(topicCode).los.push({ code: loCode, text });
}

// Granular AO inference (mirrors AO_VERBS_SCI from coverage-infer.ts).
function inferAOs(text) {
  const t = ` ${text.toLowerCase()} `;
  const out = new Set();
  if (/\b(define|state|name|describe|explain|outline|phenomena|law|theory|concept)\b/.test(t)) out.add("A1");
  if (/\b(symbol|formula|notation|unit|terminology|vocabulary|nuclide|convention)\b/.test(t)) out.add("A2");
  if (/\b(apparatus|burette|pipette|cylinder|syringe|technique|safety|instrument|thermometer|balance)\b/.test(t)) out.add("A3");
  if (/\b(mass|volume|temperature|concentration|determine|measure|quantity|rate|energy)\b/.test(t)) out.add("A4");
  if (/\b(application|social|economic|environmental|industrial|fuel|pollution|atmosphere|alloy|polymer)\b/.test(t)) out.add("A5");
  if (/\b(locate|select|organise|organize|present|from the|given the)\b/.test(t)) out.add("B1");
  if (/\b(translate|interpret|convert|graph|chart|table|diagram)\b/.test(t)) out.add("B2");
  if (/\b(calculate|manipulate|compute|stoichiometr|moles of|mol\/dm)\b/.test(t)) out.add("B3");
  if (/\b(identify|trend|pattern|infer|deduce|compare)\b/.test(t)) out.add("B4");
  if (/\b(explain|account for|reasoned|relationship|in terms of)\b/.test(t)) out.add("B5");
  if (/\b(predict|propose|hypothesis|hypothesise|hypothesize|suggest)\b/.test(t)) out.add("B6");
  if (/\b(solve|problem|to find|to determine)\b/.test(t)) out.add("B7");
  if (out.size === 0) { out.add("A1"); out.add("B5"); }
  return Array.from(out);
}

sql.push(`-- ═════ A. Refresh Chemistry topics from Chemistry_Dataset_mod-2.xlsx ═════`);

// First, delete topics that are no longer in the canonical XLSX (11.x, 12).
const xlsxTopicCodes = new Set(groups.keys());
sql.push(`-- Drop Chemistry topics not present in the new XLSX (e.g. 11.x organic, 12 air quality)`);
sql.push(
  `DELETE FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section='Chemistry' AND topic_code NOT IN (${[...xlsxTopicCodes].map(q).join(",")});`,
);

// Rename legacy flat codes 5 → 5.1, 6 → 6.1, 7 → 7.1 if they still exist.
sql.push(`-- Renumber legacy flat codes to match XLSX granularity`);
sql.push(`UPDATE public.syllabus_topics SET topic_code='5.1' WHERE source_doc_id=${q(DOC_ID)} AND section='Chemistry' AND topic_code='5';`);
sql.push(`UPDATE public.syllabus_topics SET topic_code='6.1' WHERE source_doc_id=${q(DOC_ID)} AND section='Chemistry' AND topic_code='6';`);
sql.push(`UPDATE public.syllabus_topics SET topic_code='7.1' WHERE source_doc_id=${q(DOC_ID)} AND section='Chemistry' AND topic_code='7';`);

// Refresh existing topic rows + insert any missing ones (e.g. 7.2 Electrolysis).
sql.push(`-- Upsert each topic group from the XLSX (LO sentences + granular AOs)`);
let position = 0;
for (const [topicCode, g] of groups.entries()) {
  position++;
  const aoSet = new Set();
  g.los.forEach((lo) => inferAOs(lo.text).forEach((c) => aoSet.add(c)));
  g.los.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const loSentences = g.los.map((lo) => lo.text);
  const firstLoCode = g.los[0]?.code ?? "";
  const aoCodes = Array.from(aoSet).sort();

  // Upsert: try update, fall back to insert if row doesn't exist.
  sql.push(
    `INSERT INTO public.syllabus_topics ` +
      `(source_doc_id, paper_id, section, topic_code, learning_outcome_code, strand, sub_strand, title, learning_outcomes, ao_codes, outcome_categories, depth, position, subject, level) ` +
      `SELECT ${q(DOC_ID)}, ${q(PAPER3_ID)}, 'Chemistry', ${q(topicCode)}, ${q(firstLoCode)}, ${q(g.strand)}, ${q(g.title)}, ${q(g.title)}, ${pgArr(loSentences)}, ${pgArr(aoCodes)}, ARRAY['Knowledge','Understanding']::text[], 1, ${position}, 'Science', 'Sec 4' ` +
      `WHERE NOT EXISTS (SELECT 1 FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section='Chemistry' AND topic_code=${q(topicCode)});`,
  );
  sql.push(
    `UPDATE public.syllabus_topics SET ` +
      `title=${q(g.title)}, ` +
      `strand=${q(g.strand)}, ` +
      `sub_strand=${q(g.title)}, ` +
      `learning_outcome_code=${q(firstLoCode)}, ` +
      `learning_outcomes=${pgArr(loSentences)}, ` +
      `ao_codes=${pgArr(aoCodes)}, ` +
      `paper_id=${q(PAPER3_ID)}, ` +
      `position=${position}, ` +
      `updated_at=now() ` +
      `WHERE source_doc_id=${q(DOC_ID)} AND section='Chemistry' AND topic_code=${q(topicCode)};`,
  );
}

// ─── B) Drop Biology rows from 5086 (it's Physics+Chem only per Format sheet) ─
sql.push(`\n-- ═════ B. 5086 = Physics + Chemistry only — drop orphan Biology rows ═════`);
sql.push(`DELETE FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section='Biology';`);

// ─── C) Auto-tag Physics with granular AOs (default A1+B5 if no XLSX yet) ────
sql.push(`\n-- ═════ C. Bring Physics rows up to granular AOs (no XLSX → safe defaults A1,B5) ═════`);
sql.push(
  `UPDATE public.syllabus_topics SET ao_codes = ARRAY['A1','B5']::text[], updated_at=now() ` +
    `WHERE source_doc_id=${q(DOC_ID)} AND section='Physics' AND ao_codes && ARRAY['A','B']::text[];`,
);
// Then, for any Physics topic with non-empty learning_outcomes, run the
// inference engine so we get a richer A1..B7 set than the bare default.
sql.push(`-- Refine Physics AO tags using the LO text already in each row`);
sql.push(`DO $$
DECLARE
  rec RECORD;
  ao_set TEXT[];
  lo TEXT;
  s TEXT;
BEGIN
  FOR rec IN SELECT id, learning_outcomes FROM public.syllabus_topics
             WHERE source_doc_id='${DOC_ID}' AND section='Physics'
             AND learning_outcomes IS NOT NULL AND array_length(learning_outcomes,1) > 0 LOOP
    ao_set := ARRAY[]::text[];
    FOREACH lo IN ARRAY rec.learning_outcomes LOOP
      s := ' ' || lower(lo) || ' ';
      IF s ~ '\\m(define|state|name|describe|explain|outline)\\M' THEN ao_set := array_append(ao_set, 'A1'); END IF;
      IF s ~ '\\m(symbol|formula|notation|unit|terminology)\\M'   THEN ao_set := array_append(ao_set, 'A2'); END IF;
      IF s ~ '\\m(apparatus|technique|instrument|safety)\\M'      THEN ao_set := array_append(ao_set, 'A3'); END IF;
      IF s ~ '\\m(mass|volume|temperature|determine|measure|quantity|rate|energy)\\M' THEN ao_set := array_append(ao_set, 'A4'); END IF;
      IF s ~ '\\m(application|environmental|industrial|fuel|pollution)\\M' THEN ao_set := array_append(ao_set, 'A5'); END IF;
      IF s ~ '\\m(translate|interpret|graph|chart|table|diagram)\\M' THEN ao_set := array_append(ao_set, 'B2'); END IF;
      IF s ~ '\\m(calculate|manipulate|compute)\\M'              THEN ao_set := array_append(ao_set, 'B3'); END IF;
      IF s ~ '\\m(identify|trend|pattern|infer|deduce|compare)\\M' THEN ao_set := array_append(ao_set, 'B4'); END IF;
      IF s ~ '\\m(explain|account for|relationship)\\M'          THEN ao_set := array_append(ao_set, 'B5'); END IF;
      IF s ~ '\\m(predict|propose|hypothes|suggest)\\M'          THEN ao_set := array_append(ao_set, 'B6'); END IF;
      IF s ~ '\\m(solve|problem)\\M'                              THEN ao_set := array_append(ao_set, 'B7'); END IF;
    END LOOP;
    IF array_length(ao_set,1) IS NULL THEN ao_set := ARRAY['A1','B5']; END IF;
    UPDATE public.syllabus_topics
       SET ao_codes = ARRAY(SELECT DISTINCT unnest(ao_set) ORDER BY 1),
           updated_at = now()
     WHERE id = rec.id;
  END LOOP;
END $$;`);

// ─── D) Section A/B sub-paper rows for Papers 2, 3, 4 ────────────────────────
sql.push(`\n-- ═════ D. Section A/B split for Papers 2/3/4 (per XLSX Format sheet) ═════`);
const subPapers = [
  { parent: PAPER2_ID, num: "2", section: "Physics", code: "5086/02" },
  { parent: PAPER3_ID, num: "3", section: "Chemistry", code: "5086/03" },
  { parent: PAPER4_ID, num: "4", section: "Biology", code: "5086/04" },
];
for (const p of subPapers) {
  // Section A child
  sql.push(
    `INSERT INTO public.syllabus_papers ` +
      `(source_doc_id, paper_number, paper_code, component_name, section, marks, weighting_percent, duration_minutes, position, is_optional, assessment_mode) ` +
      `SELECT ${q(DOC_ID)}, ${q(p.num + "A")}, ${q(p.code + "/A")}, 'Section A — Compulsory structured (last Q = 10m)', ${q(p.section)}, 55, NULL, NULL, ${100 + parseInt(p.num)}, true, 'structured' ` +
      `WHERE NOT EXISTS (SELECT 1 FROM public.syllabus_papers WHERE source_doc_id=${q(DOC_ID)} AND paper_number=${q(p.num + "A")});`,
  );
  // Section B child
  sql.push(
    `INSERT INTO public.syllabus_papers ` +
      `(source_doc_id, paper_number, paper_code, component_name, section, marks, weighting_percent, duration_minutes, position, is_optional, assessment_mode) ` +
      `SELECT ${q(DOC_ID)}, ${q(p.num + "B")}, ${q(p.code + "/B")}, 'Section B — Choose 1 of 2 free-response', ${q(p.section)}, 10, NULL, NULL, ${110 + parseInt(p.num)}, true, 'free_response' ` +
      `WHERE NOT EXISTS (SELECT 1 FROM public.syllabus_papers WHERE source_doc_id=${q(DOC_ID)} AND paper_number=${q(p.num + "B")});`,
  );
}

// ─── E) Practical-skill topic rows for Paper 5 (C1..C6) ─────────────────────
sql.push(`\n-- ═════ E. Practical skill topics for Paper 5 (one row per AO C1..C6) ═════`);
const cSkills = [
  { code: "C1", title: "Follow a sequence of instructions", lo: "Follow a sequence of instructions provided in writing or by demonstration to carry out a practical task safely and accurately." },
  { code: "C2", title: "Use techniques, apparatus and materials", lo: "Select and use appropriate techniques, apparatus and materials, including standard laboratory glassware, measuring instruments and chemicals, with due regard for safety." },
  { code: "C3", title: "Make and record observations and measurements", lo: "Make and record observations, measurements and estimates with appropriate precision, including correct units and significant figures, and present them in a suitable form (table, diagram, written description)." },
  { code: "C4", title: "Interpret and evaluate observations and results", lo: "Interpret and evaluate experimental observations and results, including identification of anomalies, plotting of graphs, and drawing of conclusions consistent with the evidence collected." },
  { code: "C5", title: "Plan investigations", lo: "Plan an investigation, including selection of techniques, apparatus and materials, identification of variables to control, and a procedure capable of producing reliable evidence." },
  { code: "C6", title: "Evaluate methods and suggest improvements", lo: "Evaluate methods, suggest possible improvements or extensions to a procedure (without needing to execute them), and identify limitations of the experimental design." },
];
for (let i = 0; i < cSkills.length; i++) {
  const c = cSkills[i];
  sql.push(
    `INSERT INTO public.syllabus_topics ` +
      `(source_doc_id, paper_id, section, topic_code, learning_outcome_code, strand, sub_strand, title, learning_outcomes, ao_codes, outcome_categories, depth, position, subject, level) ` +
      `SELECT ${q(DOC_ID)}, ${q(PAPER5_ID)}, 'Practical', ${q(c.code)}, ${q(c.code)}, 'Experimental Skills and Investigations', ${q(c.title)}, ${q(c.title)}, ${pgArr([c.lo])}, ${pgArr([c.code])}, ARRAY['Skills']::text[], 1, ${200 + i}, 'Science', 'Sec 4' ` +
      `WHERE NOT EXISTS (SELECT 1 FROM public.syllabus_topics WHERE source_doc_id=${q(DOC_ID)} AND section='Practical' AND topic_code=${q(c.code)});`,
  );
}

// ─── F) Wire Paper 1 (MCQ, Physics+Chem) and Paper 5 to topic pools ─────────
sql.push(`\n-- ═════ F. Link Paper 1 (MCQ) and Paper 5 (Practical) to their topic pools ═════`);
sql.push(`-- Paper 1 MCQ covers Physics + Chemistry topics`);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (topic_id, paper_id) ` +
    `SELECT id, ${q(PAPER1_ID)} FROM public.syllabus_topics ` +
    `WHERE source_doc_id=${q(DOC_ID)} AND section IN ('Physics','Chemistry') ` +
    `ON CONFLICT DO NOTHING;`,
);
sql.push(`-- Paper 5 Practical covers Physics + Chemistry topics PLUS the C1..C6 practical skills`);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (topic_id, paper_id) ` +
    `SELECT id, ${q(PAPER5_ID)} FROM public.syllabus_topics ` +
    `WHERE source_doc_id=${q(DOC_ID)} AND section IN ('Physics','Chemistry','Practical') ` +
    `ON CONFLICT DO NOTHING;`,
);
sql.push(`-- Also link the Section A/B child papers to the same topics as their parent`);
sql.push(
  `INSERT INTO public.syllabus_topic_papers (topic_id, paper_id) ` +
    `SELECT t.id, p.id FROM public.syllabus_topics t ` +
    `JOIN public.syllabus_papers p ON p.source_doc_id = t.source_doc_id AND p.section = t.section ` +
    `WHERE t.source_doc_id=${q(DOC_ID)} AND p.paper_number IN ('2A','2B','3A','3B','4A','4B') ` +
    `ON CONFLICT DO NOTHING;`,
);

// ─── G) Annotate document notes ─────────────────────────────────────────────
sql.push(`\n-- ═════ G. Refresh document notes with the canonical Format summary ═════`);
sql.push(
  `UPDATE public.syllabus_documents SET notes = ` +
    `'[5086 Combined Science (Physics, Chemistry)] ' || ` +
    `'AO weighting: A ≈ 50% (with ~20% recall via A1), B ≈ 50% on theory papers; C = 100% on Paper 5. ' || ` +
    `'Candidates take Paper 1 (MCQ, 40m, 1h, Physics+Chem), Paper 5 (Practical, 30m, 1h30, Physics+Chem), ' || ` +
    `'and TWO of Paper 2 (Physics, 65m, 1h15) / Paper 3 (Chemistry, 65m, 1h15) / Paper 4 (Biology — N/A for 5086). ' || ` +
    `'Each structured paper splits into Section A (55m compulsory, last Q = 10m) and Section B (10m, choose 1 of 2).' ` +
    `WHERE id=${q(DOC_ID)};`,
);

console.log(sql.join("\n"));
