
Edits in `src/routes/oversight.tsx` only — presentation changes.

**1. Remove "Papers set per setter" card**
- Delete the entire card block (lines 601–644), including its TooltipProvider/Tooltip rows.
- Remove the now-unused `perSetter` useMemo (lines 225–265) since no other consumer remains on this page.

**2. Enhance "Setting load (points)" → horizontal bar chart with hover details**
- Replace the existing simple rendering (lines 646–673) with a new per-setter rollup that combines setting points (bar value) with rich metadata (hover content).
- Build a new `settingLoad` useMemo derived from `setterDeployments` + `paperById` + `markerDeployments`:
  - `name` — teacher name (or "Unassigned")
  - `points` — sum of `points` on that teacher's setter deployments
  - `papers` — count of distinct paper IDs they set
  - `paperTitles: string[]` — distinct paper titles
  - `subjects: string[]` — distinct subjects (from each paper)
  - `levels: string[]` — distinct levels (from each paper)
  - `postingGroups: string[]` — distinct values from `paper.stream` (G3/G2/G1 etc.); fall back to filtering empties
  - `classLabels: string[]` — distinct downstream class labels by joining each set paper to its `markerDeployments`
- Sort descending by `points`, filter `points > 0`.
- Render as the existing bar-chart pattern (violet bar, points on the right) wrapped in `TooltipProvider` + `Tooltip`/`TooltipTrigger asChild`/`TooltipContent`.
- Tooltip shows: points, papers (count + titles), subjects, levels, posting groups, classes.

**3. No changes**
- Keep the "Marker deployments" table, "Scripts by level", "Scripts assigned per marker" bar chart, "Uploaded imports" card, KPI strip, and filters as-is.
- No DB / schema / business-logic changes.
