## Goal

Rebuild the deployment template so it's a proper data-entry tool, not just an example: editable teacher roster, dropdowns for assessment/teacher/stream, and a layout grouped by the four school terms. Also extend the points engine so G1/NT papers count as 1pt (already true) and the importer recognises the new shape.

## What changes

### 1. Template file (`scripts-tmp/build-marking-template.mjs` → regenerated `public/templates/setters-markers-template.xlsx`)

Single sheet `Deployment`. Top of sheet, before the data table:

```
ROSTER — overwrite with your colleagues' real names. The dropdowns below update automatically.
A: Andy        F: Fiona        K: Kenneth      P: Priya
B: Barry       G: Gerald       L: Lina         Q: Quentin
C: Cecilia     H: Hannah       M: Marcus       R: Rohan
D: Douglas     I: Imran        N: Nadia        S: Siti
E: Elaine      J: Jocelyn      O: Oliver       T: Tomás
```

Names live in a named range `Teachers` (≈ 26 rows, alphabetical Andy…Zane) so users can rename in place and dropdowns auto-update. A second named range `Assessments` holds `WA1, WA2, WA3, Exam`. A third `Streams` holds `G3, G2, G1, G3+G2, G3+G2+G1`.

Data table headers (one row, frozen):

```
SN | Term | Assessment | Stream | Level | Subject | Duration | Setter | Marker | Classes | 1..10 | Total | Remarks
```

Body grouped by term with banded section headers spanning the row:

```
─── TERM 1 ───
 1  T1  WA1  G3      Sec 3   Combined Sci (Phy/Chem)  1h     Andy   Andy   3A1, 3A2  …
 2  T1  WA1  G2      Sec 3   Combined Sci (Phy/Chem)  45m    Andy   Barry  3N1       …
─── TERM 2 ───
 3  T2  WA2  G3+G2   Sec 1   Geography                1h     Cecilia Cecilia 1A1,1A2  …
─── TERM 3 ───
─── TERM 4 ───
 …  T4  Exam G3      Sec 3   …
```

Data validation:
- `Term` → list `T1, T2, T3, T4`
- `Assessment` → `=Assessments` (WA1/WA2/WA3/Exam)
- `Stream` → `=Streams` (G3 / G2 / G1 / G3+G2 / G3+G2+G1)
- `Setter`, `Marker` → `=Teachers` (single-select; user types `Andy / Barry` freehand for co-deployments — Excel allows free text, just shows a warning)
- `1..10` per-class scripts → integer ≥ 0
- `Total` → `=SUM(...)` pre-filled
- A few example rows per term, all using roster names, marked italic + "(example, delete)".

Term sections give the user clear room across all four terms. Empty rows under each banner are pre-validated so users just fill them in.

### 2. Importer (`src/lib/marking-import.ts`)

Add three header aliases:

- `term` → `term` (T1/T2/T3/T4 → stored on `marking_papers.semester` as `Term 1` etc., overrides the form's Semester field per row when present)
- `stream` → `stream` (overrides regex-based parse from Level when set; map `G3→Exp`, `G2→NA`, `G1→NT`, combos like `G3+G2` keep `Exp` on the row and the importer creates an extra G2 sibling row sharing subject+year so points engine auto-links them as variants)
- skip rows whose Level cell holds a banner like `─── TERM 1 ───`

Also accept `Exam` as an assessment: classify as `eoy` (full paper) in `marking-points.ts` so it scores 2pt for G3 / 1.5pt standalone G2 / 1pt G2-variant / 1pt G1.

### 3. Points engine (`src/lib/marking-points.ts`)

Already returns `g1OrNT = 1.0` for G1 — confirmed correct, no change to rules. Add `Exam` to the `classifyAssessment` map (treat as `eoy`). Document in the file header that G1 is intentionally 1pt (parity with G2-variant), per user spec.

### 4. Oversight import UI (`src/routes/oversight.import.tsx`)

Add a small legend under the upload card explaining the new template shape (Term grouping, dropdowns, roster). No logic changes beyond surfacing `term` in the preview table as a leading column.

## Out of scope

- Schema migration: `marking_papers.semester` already stores free text, so `Term 1`…`Term 4` slots in cleanly. No DB change.
- The Dashboard view itself — grouping by term in the dashboard UI is a separate follow-up; this plan only fixes the *template* and *import path*.

## Files touched

- `scripts-tmp/build-marking-template.mjs` (rewrite)
- `public/templates/setters-markers-template.xlsx` (regenerated artefact)
- `src/lib/marking-import.ts` (new columns: Term, Stream; banner-row skip)
- `src/lib/marking-points.ts` (Exam → eoy; comment on G1)
- `src/routes/oversight.import.tsx` (legend + Term column in preview)