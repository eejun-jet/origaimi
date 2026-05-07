## Why "no KO coverage" appears

I checked the syllabus document this set uses (5086 4E5N). Every topic row has `outcome_categories = []` (zero entries) — the KO containers in this dataset are stored in the `strand` column (38 strands), with `sub_strand` (101 buckets) underneath, and 274 LOs in `learning_outcomes`. Every LO is properly nested under a strand/sub-strand. The current paper-set view only reads `outcome_categories`, so it sees nothing and prints "No KO tags". The data is fine — the view is reading the wrong column.

The Assessment Coach view (`src/routes/assessment.$id.tsx`, `koLoGroups` around line 2971) already does this correctly using `t.strand` → `t.sub_strand` → `t.learning_outcomes`. We mirror that pattern here.

## What changes

**Files**: `src/routes/paper-set.$id.tsx` only. No DB migration.

### 1. Pull strand/sub_strand from the syllabus
- Extend the `SyllabusTopic` type and the `syllabus_topics` select to include `strand`, `sub_strand`, `learning_outcome_code`.

### 2. Build a single `koLoGroups` structure
Mirror the Assessment Coach logic:
- KO container = `strand` (fallback to `topic` title).
- Sub-bucket = `sub_strand` (fallback to topic title).
- LOs = `learning_outcomes` (deduped, with optional code from `learning_outcome_code`).
- For each LO, mark `covered: true` if any non-mark-scheme question in the set has it tagged (normalised text match), and aggregate per-paper counts.
- For each KO, compute: `coveredLOs / totalLOs`, `coveragePct`, `questionsTouching`, per-paper hit map, plus the same `OverviewStatus` (covered / under-tested / over-tested / untested) used in the coach view.

### 3. Replace the two flat tabs with a single drill-down explorer
- **AO balance** tab: unchanged.
- **Per-paper** tab: unchanged.
- **Macro summary** tab: unchanged.
- **Coverage** tab (replaces "By KO" + "By LO"):
  - Default view: KO **tile grid** (one card per strand) showing strand name, discipline pill, `covered/total LOs`, coverage bar, total marks/questions touching it, and status chip — exactly the visual language used in the Assessment Coach overview tiles.
  - Click (or double-click) a tile → detail panel for that KO listing its sub-strands, each sub-strand listing its LOs with covered/uncovered badges and per-paper P1…Pn dots (the existing `CoverageList` row treatment).
  - Status filter chips (All / Covered / Under-tested / Untested) above the grid.
  - "Back to KO grid" button when in detail view.

### 4. Keep the tagging-gap banner
The amber banner showing per-paper untagged-question counts and per-paper "Reclassify this paper" buttons stays — it's orthogonal to the coverage view.

### 5. Header relabelling
The "X of Y syllabus outcomes assessed" copy with the "real exams test ~20–30%" tooltip stays, but moves to the KO grid header so it sits above the tiles.

## Result for your current set

For "test i" (5086 prelims), the Coverage tab will then show 38 KO tiles grouped by Physics / Chemistry, with realistic coverage like "Kinematics — 4/8 LOs covered (50%)" instead of the empty state, and clicking a tile drills into its sub-strands and LOs.

Approve and I'll implement.