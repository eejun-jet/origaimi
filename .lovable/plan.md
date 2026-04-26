## What the new XLSX confirms

Compared the upload (`Chemistry_Dataset_mod-2.xlsx`) against what's currently in the database for 5086 Combined Science. Findings:

**Already correct (no work needed):**
- AO definitions A1–A5, B1–B7, C1–C6 match the XLSX exactly.
- 17 of 22 Chemistry topic rows (1.1 → 10) carry granular `A1..B7` AO tags from the previous ingestion.

**Wrong / stale / missing:**

| # | Issue | Evidence |
|---|---|---|
| 1 | 5 Chemistry topic rows still on legacy `[A, B]` letters: **11.1 Fuels & Crude Oil, 11.2 Hydrocarbons, 11.3 Alcohols & Carboxylic Acids, 11.4 Polymers, 12 Maintaining Air Quality** | Not present in the XLSX, so previous ingestion skipped them |
| 2 | DB has flat topic codes `5`, `6`, `7` but the XLSX uses `5.1`, `6.1`, `7.1`, `7.2` (Redox Concepts vs Electrolysis is one row in DB, two in XLSX) | `topic_code` mismatch — Coverage drawer can't surface "Electrolysis" as a distinct LO group |
| 3 | **Paper 1 MCQ (0 topics linked)** and **Paper 5 Practical (0 topics linked)** | Per XLSX Format sheet, Paper 1 = Physics + Chemistry, Paper 5 = Physics + Chemistry (5086) — both should expose those topics |
| 4 | Physics topics (16 rows) still on legacy `[A, B]` — never ingested with granular AOs | All Physics rows show `ao_codes: [A, B]` |
| 5 | Papers 2/3/4 stored as single 65-mark blocks; XLSX format says **Section A = 55 m (last Q = 10 m), Section B = 10 m (choose 1 of 2)** | `syllabus_papers` has no section split |
| 6 | A1 "Recall" sub-weight (20% of total marks) not encoded | Format sheet line 2 — affects MCQ blueprint targets |
| 7 | Biology rows tagged to 5086 (12 topics, all letter-code) — actually wrong syllabus association: 5086 = Physics + Chemistry only | Format line 16: "Science (Physics, Chemistry), Syllabus 5086" |

---

## Plan

### 1. Refresh Chemistry topics 11.x and 12 with granular AOs
These topics aren't in the XLSX (the 2025 syllabus dropped Organic Chemistry from the Combined Science scope), so confirm with you: **delete them**, or keep them but auto-tag with the inference engine. Default action in this plan: **delete** topics 11.1, 11.2, 11.3, 11.4, 12 from `syllabus_topics` for 5086 Chemistry, since the canonical XLSX is authoritative.

### 2. Restructure topic codes to match XLSX exactly
- Rename topic_code `5` → `5.1`, `6` → `6.1`, `7` → `7.1` (Redox Concepts).
- Insert new row `7.2 Electrolysis` with its 1 LO from the XLSX.
- Refresh LO sentences and granular AO tags for all 18 Chemistry groups using the new XLSX (re-runs the existing `ingest_5086_chem.mjs` against the new file).

### 3. Ingest granular AOs for Physics
Apply the same command-word inference (`coverage-infer.ts AO_VERBS_SCI`) to all 16 Physics topic rows so they carry `A1..B7` instead of `[A, B]`. This is automatic — no XLSX needed for Physics since you haven't supplied one. When you upload a Physics XLSX I'll re-run with the canonical text.

### 4. Drop the orphaned Biology topics from 5086
Delete the 12 Biology rows under doc `65010473…` (5086 is Physics+Chem only per the XLSX Format sheet). Biology stays attached to 5087/5088 syllabuses if those are added later.

### 5. Wire Paper 1 (MCQ) and Paper 5 (Practical) to a topic pool
- **Paper 1**: link every 5086 Physics + Chemistry topic to Paper 1's `paper_id` via a new join table `syllabus_topic_papers (topic_id, paper_id)`. `loadPaperTopics()` reads through this table when present, otherwise falls back to `paper_id` direct match (back-compat for other syllabuses).
- **Paper 5**: same join, plus add 6 synthetic "Practical skill" topic rows tagged C1..C6 with the canonical SEAB descriptors as LOs.

### 6. Encode the section structure for Papers 2/3/4
Update the 3 rows in `syllabus_papers`:
- Insert child rows: `2A` (55 m, compulsory), `2B` (10 m, 1-of-2). Same for Papers 3 and 4. Use the existing `section` column.
- Generator's `defaultSection()` already supports per-section marks/instructions, so these surface as suggested blueprint sections in `/new`.

### 7. Add A1 recall sub-quota to coverage targets
In `src/routes/assessment.$id.tsx` `computeCoverage()`, when the assessment is tagged to 5086 add a derived target: A1 ≥ 20% of total marks (separate from the A 50% block). Surfaces in the Coverage panel as "Recall (A1) target ≥ Xm".

### 8. Scope the AO list and topic pool to the chosen paper at runtime
- `assessment.$id.tsx` `loadAll`: when `syllabus_paper_id` is set, filter `aoDefs` to the paper's relevant prefix (`A*`/`B*` for Papers 1–4, `C*` for Paper 5).
- `supabase/functions/generate-assessment/index.ts`: restrict the `Assessment Objectives pool` and topic candidate pool the LLM sees to the chosen paper.

### 9. Re-run the post-generation tagger on existing 5086 mocks
After the DB changes, `expandQuestionTags` will produce non-empty pools for MCQ + Practical. A one-shot script re-tags every existing `assessment_questions` row whose assessment is tagged to 5086.

---

## Confirmations needed before I implement

I'd like to lock down 4 choices before code/migration changes:

1. **Topics 11.x & 12 (Organic Chemistry, Air Quality) — delete or keep?** XLSX excludes them. Default = delete.
2. **Biology rows under 5086 — delete?** XLSX Format says 5086 = Physics + Chem only. Default = delete.
3. **Section A/B split for Papers 2/3/4** — store as child rows in `syllabus_papers` (default), or as a flag on the existing row?
4. **Physics granular AOs** — auto-tag now using the inference engine (default), or wait for a Physics XLSX?

I'll then run a single migration + ingestion script + edge-function redeploy to apply everything.

---

## Technical summary (for reference)

- **DB migration:** new join table `syllabus_topic_papers (topic_id uuid, paper_id uuid, primary key)`; renames + deletes on `syllabus_topics`; insert C1..C6 practical-skill topic rows; insert child paper rows for 2A/2B/3A/3B/4A/4B.
- **Ingestion script:** rerun `scripts-tmp/ingest_5086_chem.mjs` against `Chemistry_Dataset_mod-2.xlsx`.
- **Code changes:** `src/lib/syllabus-data.ts` (loadPaperTopics via join), `src/routes/assessment.$id.tsx` (AO scoping + A1 recall target), `supabase/functions/generate-assessment/index.ts` (paper-scoped pools), `src/lib/coverage-infer.ts` (no change — already covers A1..C6).
- **Re-tag pass:** in-place `UPDATE assessment_questions` for every 5086 question using the new pools.
