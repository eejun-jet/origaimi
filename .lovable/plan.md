## Goal
Replace the Bloom-only **TOS Alignment Meter** in the assessment editor with a richer AO / KO / LO coverage panel that:
- shows actual vs. target marks per **AO**, **KO**, and per **LO**,
- gives a **per-section breakdown** (marks per section, KO/LO marks within each section),
- gives a **whole-paper overview** at the top of the sidebar.

## What's there today (in `src/routes/assessment.$id.tsx`)
- Sidebar block "TOS Alignment Meter" only computes `targetByBloom` / `actualByBloom` from `section.bloom` and `q.bloom_level`.
- Each `Question` row already has `ao_codes`, `learning_outcomes`, `knowledge_outcomes` (added in the recent migration).
- Each `Section` (in `src/lib/sections.ts`) already carries `ao_codes`, `knowledge_outcomes`, `learning_outcomes`, plus `marks` and `num_questions`.
- AO weightings per syllabus doc live in `syllabus_assessment_objectives` (`code`, `title`, `weighting_percent`) and the assessment row already stores `syllabus_doc_id`.

## Plan

### 1. Load AO definitions for the editor
On `loadAll()` in `assessment.$id.tsx`, after fetching the assessment row, if `assessment.syllabus_doc_id` is present, also fetch:
```ts
supabase.from("syllabus_assessment_objectives")
  .select("code,title,weighting_percent")
  .eq("source_doc_id", assessment.syllabus_doc_id)
  .order("position");
```
Store as `aoDefs: { code, title, weighting_percent }[]`. Used to label AO rows and compute target marks (`weighting_percent / 100 * total_marks`).

### 2. Compute coverage from questions + sections
Add a single `computeCoverage(questions, sections, aoDefs, totalMarks)` helper that returns:
```ts
{
  paper: {
    aos:   { code, title, target, actual }[],     // target = aoDef.weighting % of total_marks; actual = sum of marks of questions tagged with that AO
    kos:   { name, target, actual }[],            // target = sum of section.marks where section.knowledge_outcomes includes name; actual = sum of marks of questions tagged with KO
    los:   { text, target, actual, covered }[],   // target = number of section-targeted occurrences (binary 1 per section that lists the LO); actual = number of questions covering it; covered = actual > 0
    sectionMarks: { letter, target, actual }[],   // target = section.marks; actual = sum of question marks in that section
  },
  bySection: Record<sectionId, {
    marks: { target, actual },
    aos:   { code, title, actual }[],            // marks per AO inside this section
    kos:   { name, actual }[],
    los:   { text, actual, covered }[],
  }>,
}
```
Tagging multi-AO/multi-KO questions: count the question's full marks once per tag (so a 4-mark question tagged AO1+AO2 contributes 4 to AO1 and 4 to AO2). Show this convention in a small tooltip ("Marks count once per tagged objective").

### 3. Replace the TOS Alignment Meter
Rewrite the sidebar `<aside>` block. New structure:

```text
┌── Paper overview ───────────────────────────────┐
│ Total marks   42 / 50                           │
│ Sections      A 18/20 · B 14/15 · C 10/15       │
└─────────────────────────────────────────────────┘

┌── AO Coverage (paper) ──────────────────────────┐
│ AO1  ███████░  18 / 20   (40 %)                 │
│ AO2  ████░░░░  12 / 25   (50 %)                 │
│ AO3  ░░░░░░░░   0 / 5    (10 %)                 │
└─────────────────────────────────────────────────┘

┌── KO Coverage (paper) ──────────────────────────┐
│ Knowledge      ████  8 / 10                     │
│ Understanding  ██    6 / 12                     │
│ Application    ███   12 / 18                    │
│ Skills         █     2 / 10                     │
└─────────────────────────────────────────────────┘

┌── LO Coverage (paper) ──────────────────────────┐
│ 12 / 14 LOs covered                             │
│ ▾ 2 uncovered                                   │
│   · Define momentum                             │
│   · Calculate the resultant force…              │
└─────────────────────────────────────────────────┘

┌── Per-section breakdown ────────────────────────┐
│ [ Section A ▾ ]                                 │
│   Marks   18 / 20                               │
│   AOs     AO1 · 12   AO2 · 6                    │
│   KOs     Knowledge 8  Understanding 4 …        │
│   LOs     5 / 6 covered  ▸ show uncovered       │
│ [ Section B ▾ ] …                               │
└─────────────────────────────────────────────────┘
```

- Bars use the same primary/success colour scheme already in the file (`bg-primary` filling, `bg-success` when actual ≥ target).
- Each per-section block is a `<Collapsible>` (already imported pattern in the project) — Section A open by default.
- Clicking an uncovered LO scrolls/highlights its section card so the teacher can fix it (use existing `id={`q-${q.id}`}` pattern; for sections we'll add `id={`section-${letter}`}` anchors above the first question of each section).
- If `aoDefs` is empty (no syllabus doc) we still render AO rows from the union of AO codes seen in questions/sections, with `target = "—"`.

### 4. Section anchors
In the questions list render, wrap each section's first question with `<div id={`section-${letter}`}>` so the LO/section drill-down can scroll to it.

### 5. Remove Bloom dependency
Delete the `targetByBloom` / `actualByBloom` blocks in `EditorPage` and the `BLOOMS` import (kept elsewhere if still used — verify and only remove the import if unused). Bloom badges on individual `QuestionCard` stay (they're a separate concern).

## Files touched
```
src/routes/assessment.$id.tsx    new coverage helper, fetch aoDefs, replace TOS sidebar, add section anchors
```
No DB changes, no new dependencies — all required fields (`ao_codes`, `knowledge_outcomes`, `learning_outcomes`, `syllabus_doc_id`, AO weightings) already exist.

## Result
- The sidebar shows a paper-wide overview (total marks, marks per section), then AO / KO / LO coverage for the whole paper, then a collapsible per-section breakdown with marks and KO/LO tallies.
- Bloom's taxonomy is no longer the alignment yardstick; AOs / KOs / LOs are.
- Teachers can spot at a glance which section is under-marked, which AO is under-weighted, and which LOs are still uncovered — and jump straight to the relevant section.
