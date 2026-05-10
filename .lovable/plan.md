## Plan

Fix the four Dashboard issues in `src/routes/oversight.tsx` with a targeted frontend update.

### 1. Make “Marked” count as completed for the KPI
- Change the Marking Status KPI logic so:
  - **In progress** = rows with status `assigned`, `in_progress`, or `marking_done` / “Moderating”
  - **Completed** = rows with status `moderated` / “Marked”
- Include `assigned` rows in the denominator so changing a row from “Marking” to “Marked” visibly changes the percentage.
- Keep the KPI independent of the table’s search/status filter, but still respect subject/year/assessment filters.

### 2. Make “marked_count” reflect status changes immediately
- When the user changes a row to **Marked**, update that row’s `marked_count` to match `script_count`.
- When the user moves a row back to **Marking** or **Moderating**, preserve existing script counts unless the current count is clearly stale.
- This will update:
  - the row progress bar,
  - “Scripts by level”,
  - “Scripts assigned per marker”,
  - and any totals using `marked_count`.

### 3. Make “Scripts by level” use the same live cohort
- Compute the “Scripts by level” section from all marker deployments matching subject/year/assessment, not from `markerDeployments` filtered by search/status.
- This prevents rows from disappearing from the level totals just because their status changed or a status filter is active.

### 4. Make hover details explicit and add scripts-to-mark
- Extend the tooltip class breakdown data to include:
  - class,
  - subject names,
  - paper titles,
  - scripts assigned,
  - scripts marked,
  - scripts to mark.
- Update `ClassBreakdownTable` columns to show:
  - `Class`
  - `Subjects`
  - `Papers`
  - `Scripts to mark`
- Render counts as labelled text beside actual names, not as standalone parentheses that look random.

### 5. Improve realtime reliability without schema changes
- Keep the existing realtime subscription, but ensure local optimistic state updates are enough for same-tab changes even if realtime is delayed.
- Also make the subscription trigger refresh for the dashboard totals and chart data consistently.

### Technical details
- The database currently has marker rows in `assigned` and `moderated`; the existing KPI ignores `assigned`, which is why the percentage can appear unchanged or wrong.
- The visible dropdown label **Marked** maps to internal status `moderated`, so the KPI must treat `moderated` as completed.
- The chart/tooltips currently aggregate only sets of subject/paper names; they need per-class script totals added to the aggregation.