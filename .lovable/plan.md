## Goal

Replace the coarse 5086 Chemistry data currently in the database with the canonical AO / KO / LO / Format dataset from `Chemistry_Dataset_mod.xlsx`, so that paper generation, coverage analysis and the coach reviewer reason against the real syllabus rather than the inferred placeholders.

## What the spreadsheet provides

- **Sheet 1 – Assessment Outcomes (AOs):** 18 numbered sub‑objectives split into A1–A5 (Knowledge with Understanding), B1–B7 (Handling Information & Solving Problems), C1–C6 (Experimental Skills) — each with a description and command‑word hints.
- **Sheet 2 – KOs / LOs (5086 Chemistry):** 64 LOs, each with an LO code (e.g. `1.1.1`), Topic (Knowledge Outcome — 10 distinct), Content / sub‑topic (e.g. "Atomic Structure"), and the LO sentence. This is more granular than what we currently hold.
- **Sheet 3 – Format:** AO weighting (≈50% A, 50% B for theory; 100% C for practical), paper structure (P1 MCQ, P2 Physics, P3 Chemistry, P4 Biology, P5 Practical), and the rule that candidates take P1 + P5 + two of P2/3/4.

## Current state (5086 doc id `65010473…` already in DB)

- 22 Chemistry topics already exist with topic codes (1.1, 2.1, …) but **no LO codes** and topic‑level `ao_codes={A,B}` only.
- AOs stored only at letter level (A, B, C) — no A1…C6 granularity.
- Paper format already correct.

## Plan

### 1. Build a one‑off ingestion script
`scripts-tmp/ingest_5086_chem.mjs` (run locally against the project DB via `psql`). Idempotent: scoped to `source_doc_id = 65010473-aa3d-4566-80c9-303540a5add2`, `section = 'Chemistry'`.

Steps it performs:

a. **Replace AOs for 5086** (all three sections — chem ingest will not touch Bio/Physics rows, scoped by section in title where applicable). Insert 18 rows into `syllabus_assessment_objectives`:
   - `code`: `A1`…`A5`, `B1`…`B7`, `C1`…`C6`
   - `title`: short objective description (first 80 chars)
   - `description`: full objective text + ` | Command words: …` from column 5
   - `weighting_percent`: 50 for A* and B*, 100 for C* (group total derived from Format sheet)
   - `position`: 1…18

   Keep the existing letter‑level rows or remove them — see Open question 1.

b. **Upsert / refresh Chemistry topics** in `syllabus_topics`:
   - For each (Topic, Content) pair from the XLSX, ensure a row exists with:
     - `topic_code`: derived from the LO code prefix (`1.1`, `1.2`, `2.1`, `2.2`, `3.1`, `3.2`, `3.3`, `4.1`, `4.2`, `5`, `6`, `7.1`, `7.2`, `8.1`, `8.2`, `8.3`, `9`, `10`)
     - `title`: Content (e.g. "Atomic Structure")
     - `strand`: Topic (e.g. "Particulate Nature")
     - `section`: `Chemistry`
     - `learning_outcomes`: the LO sentences for that (Topic, Content) group, in LO‑code order
     - `ao_codes`: granular codes inferred from each LO's command word (e.g. *describe / state / define* → `A1`, *suggest / deduce / calculate* → `B*`); fallback `{A1,B1}` if none match.
     - `outcome_categories`: `{knowledge,skills}` (or `{knowledge,skills,values}` for 11.4 Polymers and 12 Air Quality, matching today).
     - `learning_outcome_code`: the smallest LO code in the group (e.g. `2.2.1`).

   The existing 22 topics will be reconciled — the XLSX yields ~17 (Topic, Content) groups for Chemistry. Topics in DB but missing from the XLSX (e.g. 11.* Organic, 12 Air Quality) are **kept untouched**, since the upload only covers the topics in the dataset.

c. **Format / papers**: leave `syllabus_papers` as‑is — current rows already match. Append a "Notes" line to `syllabus_documents.notes` summarising AO weighting + the "P1 + P5 + 2 of P2/3/4" rule for downstream prompts.

### 2. Wire granular AOs into the generator and coach

- `supabase/functions/generate-assessment/index.ts`: when building the AO pool for a section, prefer the granular A1…C6 codes from `syllabus_assessment_objectives` (filtered by paper section) over the topic‑level `ao_codes` array.
- `src/lib/coverage-infer.ts` and the two edge‑function copies: extend `AO_VERBS_SCI` to map command words to the new codes:
  - A1: define, state, name; A2: vocabulary/units cues; A3: apparatus, technique; A4: quantities, determination; A5: applications/social/economic.
  - B1: locate, select, organise; B2: translate (graph→table etc.); B3: manipulate, calculate; B4: identify pattern, trend, infer; B5: explain, account for; B6: predict, propose; B7: solve.
  - C1–C6: practical verbs — these only fire for Paper 5 contexts, so gate by `paper_number === '5'`.
- `src/routes/assessment.$id.tsx` already consumes `ao_codes` opaquely, so the Coverage drawer will surface the new codes automatically once they appear in the data.

### 3. Verification

After ingest, run a sanity check:
- `SELECT code, weighting_percent FROM syllabus_assessment_objectives WHERE source_doc_id='65010473…' ORDER BY position;` → 18 + (existing letter rows or 0).
- `SELECT topic_code, title, learning_outcome_code, ao_codes FROM syllabus_topics WHERE source_doc_id='65010473…' AND section='Chemistry' ORDER BY position;` → each row carries an LO code and granular AO codes.
- Generate a 5086 Paper 3 (Chemistry) mock and confirm the Coverage panel lists A1/B3/etc. instead of just "A, B".

## Files touched

- new `scripts-tmp/ingest_5086_chem.mjs` (one‑off ingest)
- `supabase/migrations/<timestamp>_ingest_5086_chem.sql` (the SQL the script emits, committed for reproducibility)
- `src/lib/coverage-infer.ts` (granular AO command‑word mapping)
- `supabase/functions/generate-assessment/coverage-infer.ts` (mirror)
- `supabase/functions/coach-review/coverage-infer.ts` (mirror)
- `supabase/functions/generate-assessment/index.ts` (prefer granular AO codes when building section AO pool)

No schema changes — existing columns (`code`, `description`, `learning_outcome_code`, `ao_codes`, `learning_outcomes`) are sufficient.

## Open questions

1. **Letter‑level AO rows** (`A`, `B`, `C`) currently exist for all three sciences in 5086. Replace them with A1…C6 only, or keep both (letter rows for legacy reports, numbered rows as the new source of truth)? Default plan: **keep both** — numbered rows added at higher `position`, so existing UIs that expect `A/B/C` still work.
2. **Scope**: this upload is Chemistry‑only. Should I also re‑label Physics and Biology topics with the same A1…C6 AO mapping, or limit the change strictly to Chemistry? Default plan: **Chemistry only** for now; apply the same treatment to Physics/Biology when those datasets arrive.
