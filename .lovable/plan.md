## Goal

Two changes to the downloaded Table of Specifications (.xlsx **and** .docx — both exports share the same data layer, so we update both):

1. **Split "Syllabus code" and "Paper number"** into two separate rows. Today the Summary shows only `Syllabus code` (e.g. `5086 / 5087 / 5088`). The user wants a new `Paper` row immediately below it (e.g. `1`).
2. **Add a condensed LO coverage table sorted by KO**, where each row is a Knowledge Outcome and its associated Learning Outcomes are listed in cell(s) on the right. For multi-discipline papers (Combined Science), split the LOs into one column per discipline (Physics / Chemistry / Biology / Practical) so a teacher can read each science's LO coverage side-by-side.

## What changes

### 1. Paper number in the Summary

- `assessments.syllabus_paper_id` already points to a `syllabus_papers` row that carries `paper_number` and `paper_code`. The assessment route does not currently load it, so we add a small fetch in `src/routes/assessment.$id.tsx` (lookup by `syllabus_paper_id` when present) and store the paper number on local state.
- Extend `TosAssessmentMeta` (in `src/lib/export-tos-xlsx.ts`) with an optional `paper_number: string | null` field.
- `tosMeta()` populates it from the loaded paper row.
- `buildSummarySheet` (xlsx) and `buildKeyValueTable` (docx) emit a new `Paper` row directly under `Syllabus code`. Render `—` when unknown.

### 2. KO-grouped LO coverage table

- Pass the section topic-pools through to the exporter so we can derive a per-LO map of `{ kos: string[]; discipline: string | null }`. Concretely, add an optional `topicIndex` argument to `exportTosXlsx` / `exportTosDocx` shaped:

  ```ts
  type TopicIndexEntry = {
    learning_outcomes: string[];
    outcome_categories: string[]; // KOs
    section: string | null;       // "Physics" | "Chemistry" | …
  };
  ```

  Built in `assessment.$id.tsx` from `sectionedBlueprint.sections[].topic_pool`.

- New helper `buildKoLoCoverageRows(coverage, topicIndex)`:
  - Rows: every KO in `coverage.paper.kos` (already KO-sorted by syllabus order).
  - For each KO, gather all LOs whose topic carries that KO. Annotate each LO with `covered` (from `coverage.paper.los`).
  - Group LOs by discipline. Format each LO as `✓ <text>` / `· <text>` so coverage is readable inline.

- New sheet **"KO → LO coverage"** in xlsx and a new section in docx, immediately after the existing AO + KO matrix.
  - Columns: `KO`, `Target`, `Actual`, `Δ`, then either:
    - **Single discipline papers** → one column `Learning Outcomes`.
    - **Multi-discipline papers** (≥2 distinct disciplines in the topic-pool, e.g. Combined Science) → one column per discipline in this order: Physics, Chemistry, Biology, Practical, Other.
  - Each LO cell lists LOs as a multi-line string, prefixed with ✓ when covered and · when uncovered. Empty cells when no LO maps to that KO+discipline combination.

- Discipline detection mirrors the existing logic in `discipline-scope.ts` (`normaliseDiscipline`). Empty / unknown disciplines collapse into "Other"; if only one bucket has entries we fall back to the single-column layout.

### Files touched

- `src/lib/export-tos-xlsx.ts` — extend `TosAssessmentMeta`, add Paper row to summary, add new "KO → LO coverage" sheet, accept optional `topicIndex`.
- `src/lib/export-tos-docx.ts` — same Paper row + new KO→LO section, accept the same `topicIndex` (re-exports the type from xlsx file).
- `src/routes/assessment.$id.tsx` — fetch paper number from `syllabus_papers` when `assessment.syllabus_paper_id` is set; build `topicIndex` from `sectionedBlueprint`; thread both into `tosMeta()` and `exportTosXlsx` / `exportTosDocx` calls.

### Out of scope

- No schema changes — `paper_number` already exists on `syllabus_papers`.
- No change to the on-screen Coverage panel; this is export-only.
- The existing Question Map sheet and AO/KO matrix are unchanged.
