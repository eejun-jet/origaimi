## Goal

Add two **"% complete"** tiles to the Marking dashboard (`/oversight`) KPI strip — one for **Paper status**, one for **Marking status** — each with two indicators ("In progress" and "Completed").

## Where this lives

`src/routes/oversight.tsx`, the KPI strip around line 498–504.

## Status mapping

**Paper status tile** (source: `papers[].paper_status`)
- In progress: `setting`, `editing`, `vetting`
- Completed: `cleared`
- % complete = Completed / (In progress + Completed)

**Marking status tile** (source: `markerDeployments[].status`)
- In progress: `in_progress` (Marking), `marking_done` (Moderating)
- Completed: `moderated` (Marked)
- % complete = Completed / (In progress + Completed)
- (Rows with status `assigned` are excluded from the denominator since they haven't started.)

Both denominators respect the current filters (subject/year/assessment/search) — Paper tile uses `visiblePapers` (papers that pass `paperPasses`), Marking tile uses the existing `markerDeployments`.

## UI

Replace the single existing `% complete` Kpi at line 502 with two new tiles. Update the KPI strip from `md:grid-cols-5` to `md:grid-cols-6` to fit.

```text
[ Papers ] [ Markers deployed ] [ Scripts assigned ] [ % complete (Paper status) ] [ % complete (Marking status) ] [ Overdue / Flagged ]
```

Each new tile renders:
- Top: label `"% complete — Paper status"` (or `"… — Marking status"`)
- Big value: `"{pct}%"`
- Sub-line: `"In progress: {n} · Completed: {m}"`

Use the existing `Kpi` component; pass the sub-line via the `sub` prop. Wrap the value in a `Tooltip` (already imported) showing the per-status counts:
- Paper: Setting · Editing · Vetting · Cleared
- Marking: Marking · Moderating · Marked

## Computation (added near existing KPI calcs ~line 230)

```ts
// Paper status rollup (visible papers only)
const visiblePapers = papers.filter(paperPasses);
const paperBuckets = { setting: 0, editing: 0, vetting: 0, cleared: 0 };
for (const p of visiblePapers) {
  const s = p.paper_status ?? "setting";
  paperBuckets[s]++;
}
const paperInProgress = paperBuckets.setting + paperBuckets.editing + paperBuckets.vetting;
const paperCompleted = paperBuckets.cleared;
const paperPctComplete = (paperInProgress + paperCompleted) > 0
  ? Math.round((paperCompleted / (paperInProgress + paperCompleted)) * 100) : 0;

// Marking status rollup (markers only, excludes "assigned")
const markBuckets = { in_progress: 0, marking_done: 0, moderated: 0 };
for (const d of markerDeployments) {
  if (d.status in markBuckets) markBuckets[d.status as keyof typeof markBuckets]++;
}
const markInProgress = markBuckets.in_progress + markBuckets.marking_done;
const markCompleted = markBuckets.moderated;
const markPctComplete = (markInProgress + markCompleted) > 0
  ? Math.round((markCompleted / (markInProgress + markCompleted)) * 100) : 0;
```

## Out of scope

- The existing scripts-based `% complete` (Marked / Assigned) — replaced by the two new tiles since the user asked for paper/marking-status-based indicators.
- Any change to the deployment table, charts, or filters.
- Schema changes — both fields already exist.

## Open question

The existing scripts-based `% complete` (Marked scripts / Assigned scripts) will be **removed** to make room. If you'd prefer to keep it as a third tile (3 "% complete" tiles total), let me know and I'll widen the strip to `md:grid-cols-7` instead.