# Add a true "Overview" map for LO coverage by KO

## Problem

In the LO Coverage card, the **Map** and **List** toggles look almost identical — both render a vertical, text-heavy list of LOs. Map just adds discipline/topic grouping with collapsibles. Neither gives the at-a-glance "where am I under- or over-testing?" picture the user wants across 10–20 KOs.

## Solution

Replace the current two-mode toggle with a **three-mode toggle**: `Overview` · `Map` · `List`, where **Overview** is a new graphical heatmap-style layout that makes balance instantly visible.

### Overview design

A grid of KO tiles (one tile per Knowledge Outcome / topic in the paper), grouped under their discipline header (Physics / Chemistry / Biology, or just "Topics" for non-science). Each tile shows:

- **KO name** (truncated, full name on hover)
- **Coverage ratio** `covered / total` LOs, big and tabular
- **Donut or radial fill** showing % of LOs covered
- **Density bar** below: 1 segment per LO in that KO, colored by how many times that LO is tested
  - grey = uncovered (0×)
  - light = covered once (1×)
  - mid = 2×
  - strong = 3+× (over-tested)
- **Status chip** in the corner:
  - `Under-tested` — `covered/total < 0.34` and total ≥ 3 (red)
  - `Thin` — partial coverage (amber)
  - `Balanced` — all covered, no LO tested >2× (green)
  - `Over-tested` — any LO tested 3+ times OR avg actual per LO > 2 (purple/warm)
  - `Untested` — 0 covered (destructive outline)

Tiles are sorted by status severity (under-tested → thin → over-tested → balanced) so problems surface first. Clicking a tile expands it inline (or scrolls into Map view focused on that KO) to show its LOs with the existing per-LO drawer behavior.

A small **legend** sits above the grid explaining the four status colors and the density-bar scale.

```text
Physics                                              8 / 14 LOs
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ Kinematics  [Under]│  │ Dynamics    [Thin] │  │ Energy    [Over×]  │
│  ◐ 1/5             │  │  ◑ 3/5             │  │  ● 4/4             │
│  ▪▫▫▫▫             │  │  ▪▪▪▫▫             │  │  ▪▪▪▪▪▪▪ (3×, 2×) │
└────────────────────┘  └────────────────────┘  └────────────────────┘
```

### Map / List unchanged

The existing collapsible Map and flat List views stay as-is for users who want to drill in. The toggle just gains a third option, defaulting to **Overview**.

## Technical details

**File:** `src/routes/assessment.$id.tsx`

1. Change the `loView` state type from `"map" | "list"` to `"overview" | "map" | "list"`, default `"overview"`.
2. Add a third toggle button "Overview" to the existing pill-toggle (lines 2048–2063). Keep it visible whenever `paper.los.length > 0` (not just for science) — non-science assessments still benefit; they'll just show a single ungrouped section.
3. Add a new `TopicsOverviewView` component near `TopicsMapView` (around line 1706). It receives the same `topicsMap`, `paperLOs`, `setTarget`, `remarkCount` props and renders the tile grid.
4. Compute per-tile status from each topic's `los` array (already carries `covered` + `actual`):
   - `untested`: coveredLOs === 0
   - `under-tested`: 0 < coveredLOs/totalLOs < 0.34 (only when totalLOs ≥ 3)
   - `thin`: coveredLOs < totalLOs (the rest)
   - `over-tested`: coveredLOs === totalLOs AND (max(actual) ≥ 3 OR avg(actual) > 2)
   - `balanced`: coveredLOs === totalLOs AND not over-tested
5. Tile uses a small SVG donut (existing project has no chart helper for this use case; a 24px inline SVG is lightest — avoids pulling Recharts for a tiny widget).
6. Density bar is a flex row of `1.5×6px` rounded segments; color steps via Tailwind utilities tied to the theme tokens (`bg-muted`, `bg-success/40`, `bg-success`, `bg-warm`).
7. Clicking a tile sets `expandedKO` local state; the expanded panel reuses the existing LO button list from `TopicsMapView` (extract a tiny `LOList` subcomponent so both views share it — avoids duplication).
8. For non-science papers (no discipline grouping), reuse the same tile grid by treating the whole paper as a single "Topics" group derived from the `bySection` KO list.

No DB schema changes, no edge function changes. Pure UI.

## Out of scope

- No new data collection — uses existing `paper.los` + `topicsMap` only.
- No changes to the KO Coverage card above (which is marks-based, not LO-coverage-based). If you also want the heatmap concept applied to that card, say so and I'll extend it.
