I understand the issue: the current “All at a glance” still exposes too many LOs, so it fails the core goal. I’ll change the Coverage Explorer so the first/default view is a real KO-level overview: 20–30 KO/topic squares first, then LO detail only after selecting a KO.

## What I will change

1. **Make Coverage Explorer open to a KO-square overview by default**
   - Rename/reframe the first tab to something like **“KO overview”**.
   - This tab will show only Knowledge Outcomes/topics as square-ish cards/tiles, not a long list of all 174 LOs.
   - Each KO tile will show at-a-glance signals:
     - KO/topic name
     - status chip: Untested / Under-tested / Thin / Balanced / Over-tested
     - covered LO count, e.g. `4/9 LOs`
     - marks tested, e.g. `12m`
     - a compact density strip showing how many child LOs are untested / tested once / tested multiple times

2. **Click a KO tile to drill down into its LOs**
   - Selecting a tile will reveal the specific LOs for that KO in a detail panel/drawer area within the explorer.
   - The LO list will stay hidden until a KO is selected.
   - LO rows will keep the existing click behavior that opens the detail drawer for evidence/questions/remarks.

3. **Improve the explorer tabs so the hierarchy is clear**
   - Tabs will be organized around the human workflow:
     - **KO overview**: tile grid, no full LO wall
     - **Drill-down**: selected KO + LO detail view
     - Optional existing map/list behavior can remain only if useful, but not as the default experience
   - The “Expand” button in LO Coverage will open directly to **KO overview**.

4. **Use topic/KOs from the actual syllabus structure, not generic categories**
   - Where available, use the existing topic pool mapping so KO cards are syllabus topics/content areas, each containing its LOs.
   - Keep fallback behavior for older/non-science papers so the explorer still works if topic mapping is incomplete.

5. **Filters stay at KO level**
   - The filter pills will filter KO tiles by status, e.g. show only under-tested or over-tested KOs.
   - Filtering will not dump all matching LOs onto the screen.

## Technical implementation

- File to edit: `src/routes/assessment.$id.tsx`.
- Rework the current `explorerMode` from the existing `matrix | drilldown` shape into a clearer KO-first explorer mode.
- Replace the current matrix content that renders every LO inside every KO card with a compact `KOTileGrid` style view.
- Reuse existing helpers already in the file:
  - `buildTopicsMap`
  - `classifyTopic`
  - `STATUS_META`
  - `CoverageDonut`
  - `DensityBar`
  - `RemarkPill`
- Preserve existing comment/evidence drawer behavior through `setTarget(...)`.
- Keep the sidebar LO Coverage improvements already made, but make the full Coverage Explorer match the same KO-first mental model.

## Result

The explorer will no longer show 174 LOs at once. It will first show the 20–30 KO/topic boxes so you can immediately judge paper spread and spot over/under-tested areas, then click into a specific KO to inspect its LOs.