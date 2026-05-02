# Download Table of Specifications (TOS)

Add a "Download TOS" button next to "Download .docx" on the assessment page. It exports the same coverage data the sidebar already computes, but as a clean, printable spreadsheet.

## Format

**.xlsx** (one workbook, three sheets). XLSX wins over PDF/DOCX here because heads-of-department typically paste TOS rows into school-wide moderation sheets — they want sortable, editable cells, not a frozen layout.

### Sheet 1 — Paper summary

A header block, then a section-by-section marks table.

```text
Title:           {assessment.title}
Subject:         {assessment.subject}
Syllabus code:   {assessment.syllabus_code ?? "—"}
Level:           {assessment.level}
Duration:        {duration_minutes} min
Total marks:     {totalActual} / {total_marks}
Generated:       {today}

Section | Name | Question type | Marks (target) | Marks (actual) | # Questions
A       | …    | Structured    | 30             | 30             | 6
…
```

### Sheet 2 — AO / KO / LO matrix (the TOS proper)

Three stacked tables on one sheet, each reusing what `computeCoverage` already produces.

**AO table** — code, title, syllabus weighting %, target marks, actual marks, delta, plus one column per section showing actual marks contributed.

```text
AO   | Title           | Weighting % | Target | Actual | Δ   | Sec A | Sec B | Sec C
AO1  | Knowledge…      | 30%         | 30     | 28     | -2  | 12    | 10    | 6
…
```

**KO table** — name, target marks (sum of section marks listing the KO), actual marks, delta, plus per-section actual.

**LO table** — text, target hits, actual hits, covered (Yes/No), plus per-section hits.

### Sheet 3 — Question-level map

Row per question so teachers can audit how individual items roll up.

```text
# | Section | Type | Marks | Topic | Bloom | AOs (codes) | KOs | LOs (count) | Stem (first 120 chars)
1 | A       | MCQ  | 1     | …     | apply | AO1, AO2    | …   | 2           | …
```

## How it's built

- New helper `src/lib/export-tos-xlsx.ts` exports `exportTosXlsx(args)` taking `{ assessment, coverage, questions, sections, aoDefs }`.
- Uses **`exceljs`** (already client-friendly, no Worker constraints, supports formatting + multiple sheets). If not installed, add via `bun add exceljs`.
- Filename: `{slug(title)}-TOS.xlsx`.
- The "Δ" delta cell is conditionally formatted: green when actual ≥ target, amber when within 1 mark, red otherwise. Plain cell colors via `fill`, no formulas — cells contain the computed numbers (target/actual already come from `computeCoverage`).
- Numbers are real numbers (not strings) so teachers can paste into their own moderation books.

## Where the button goes

In `src/routes/assessment.$id.tsx`, next to the existing "Download .docx" button (lines 563–602):

```text
[ Download .docx ] [ Download TOS ]   [ Invite reviewer ] [ Status ▾ ]
```

Disabled when `questions.length === 0`. Same toast pattern as the docx export. Identical icon (`Download`) but with a `Table` accent or just the label "Download TOS".

We also surface it once more in the sidebar at the bottom of the Coverage tab (a small `Download TOS` link) since that's where teachers are looking when they want it. Same handler, no duplication.

## Edge cases

- **No syllabus_code** → header row prints "—" and we don't fail.
- **No AO defs** → AO table shows the codes we have on questions with blank Title/Weighting; rest of the sheet still renders.
- **`assessment_type === "past_paper_analysis"`** → header gets a one-line note: "Imported from past paper" so the TOS reader knows the targets came from inferred tags rather than a teacher-set blueprint.
- **Long LO texts** → row width capped via `column.width = 60` with wrap; truncated to 250 chars with "…" appended in cell value to keep the file small.

## Out of scope

- No PDF version yet (XLSX prints fine; teachers who need PDF can "Save As" from Excel/Google Sheets).
- No CSV variant — the multi-sheet structure is the value-add.
- No server function / edge function. Pure client export, same pattern as the docx download.
