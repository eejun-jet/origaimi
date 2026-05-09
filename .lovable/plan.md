Edits in `src/routes/oversight.tsx`:

**1. Remove marking points**
- Delete the entire "Marking load (points)" card (lines 599–626).
- Keep the existing `leaderboard.marking` field harmless or remove the `marking` aggregation since nothing else consumes it on this page (the dedicated `/oversight/points` route still has its own logic). Simpler: leave the rollup but stop rendering it.

**2. "Scripts assigned per marker" → horizontal bar chart with hover details**
- Replace the existing Table with a stacked-row bar chart (same visual style already used by the Setting load card).
- Enrich `perMarker` so each entry also carries the breakdown needed on hover:
  - `classes` (count, already present)
  - `classLabels: string[]` — each class label assigned
  - `levels: string[]` — distinct levels
  - `subjects: string[]` — distinct subjects
  - `papers: string[]` — distinct paper titles
- Each row: marker name (left), bar sized by `assigned / max(assigned)` (middle), `N scripts` (right).
- Wrap each row in shadcn `Tooltip` (`@/components/ui/tooltip`). Tooltip shows: total scripts, classes (count + labels), levels, subjects, papers, and marked/flagged counters.

**3. "Papers set per setter" → horizontal bar chart with hover details**
- Replace the existing Table with the same bar-chart pattern.
- Drop the "Scripts (downstream)" column entirely.
- Bar value = total scripts associated with papers the setter set (already computed as `t.scripts`; reuse but don't show the number explicitly as a column — show it on the bar's right side as `N scripts`).
- Enrich `perSetter` with: `paperTitles: string[]`, `levels: string[]`, `subjects: string[]`, `classLabels: string[]` (from `markerDeployments` filtered to that setter's papers).
- Tooltip shows: papers set (count + titles), levels, subjects, classes covered downstream.

**4. Remove "Full leaderboard →" link**
- In the "Setting load (points)" card header, drop the right-aligned `<Button asChild variant="ghost">…/oversight/points</Button>` and revert the header to a plain `CardHeader` with just the title.
- Keep the Setting load bar chart unchanged otherwise.

**Technical notes**
- Tooltip component: `import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";` Wrap each chart's container in a single `TooltipProvider` and each row in `<Tooltip><TooltipTrigger asChild>…row…</TooltipTrigger><TooltipContent>…details…</TooltipContent></Tooltip>`.
- Bar styling reuses existing classes: `h-3 w-full overflow-hidden rounded bg-muted` outer, `h-full bg-emerald-500` (marker) / `bg-amber-500` (setter) inner — distinct from violet (setting) so cards remain visually differentiated.
- No DB / schema / business-logic changes; purely presentation.
