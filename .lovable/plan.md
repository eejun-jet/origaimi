## Goals

Fix the two Dashboard (`/oversight`) issues:

1. **"% complete — Marking Status" tile doesn't reflect changes** when a row's marking status flips to "Marked".
2. **Bar-chart hover tooltips** ("Scripts assigned per marker", "Setting load (points)") show only bare numbers in `( )` per class — the user can't see *which* subjects or *which* papers those numbers belong to.

All changes stay in `src/routes/oversight.tsx` — no schema, no business-logic rewrites.

---

## Issue 1 — Marking Status tile

### Root causes

Two separate problems compound:

a. **Tile is gated by the page's Status filter.** `markBuckets` (lines 250–257) is computed off `markerDeployments`, which already filters by `statusFilter`. When the Status filter is set to e.g. "In progress", changing a row to "Marked" makes that row drop out of `markerDeployments` entirely, so both numerator and denominator shift in lockstep and the visible % barely (or doesn't) change. KPI tiles should reflect the *whole* visible cohort, not the table's status filter.

b. **No realtime sync.** `updateMarkingStatus` does an optimistic update + `void load()`, which works for the same tab, but if the row is changed elsewhere (another tab, server-side, cron sweep) the tile stays stale until manual refresh.

### Fix

- Compute `markBuckets` from a new `markerDeploymentsForKpi` derived from `visibleDeployments` (subject/year/assessment + role==="marker", *no* `statusFilter`, *no* `search`). Keep the existing `markerDeployments` for the table.
- Add a `supabase.channel('oversight-realtime')` subscription on `marking_papers` and `marking_deployments` that calls `load()` on any change. Clean up on unmount.

```ts
const markerDeploymentsForKpi = useMemo(
  () => visibleDeployments.filter((d) => d.role === "marker"),
  [visibleDeployments],
);
// markBuckets / markInProgress / markCompleted use markerDeploymentsForKpi
```

Realtime subscription (in `OversightPage`):
```ts
useEffect(() => {
  const ch = supabase.channel('oversight-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'marking_deployments' }, () => load())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'marking_papers' }, () => load())
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, []);
```

A migration enables realtime on the two tables:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.marking_papers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.marking_deployments;
```

Also apply the same fix to `paperBuckets` so the **Paper status** tile is symmetric (it already uses `visiblePapers`, which is fine — no change needed there).

---

## Issue 2 — Tooltip shows numbers without subjects/papers

### Why it looks "random"

`ClassBreakdownTable` (lines 1021–1051) currently renders only `(subjectCount)` and `(paperCount)` per class. So a row reads e.g. `4A | (2) | (3)` — there's no indication that "(2)" means "2 subjects" or which subjects, and "(3)" means "3 papers" or which papers. The user reads it as random.

### Fix

Carry the actual names through and render them. Update the rollups in `perMarker` (lines 277–334) and `settingLoad` (lines 336–403) so each `classBreakdown` row carries:

```ts
{ classLabel, subjects: string[], papers: string[] }
```

Then `ClassBreakdownTable` becomes:

```text
Class   | Subjects (n)              | Papers (n)
4A      | Math, Science (2)         | P1 EOY, P2 EOY, P2 Mock (3)
4B      | Math (1)                  | P1 Mock (1)
```

- Subject cell: comma-joined names with the count in parens at the end.
- Paper cell: comma-joined paper titles with count in parens; truncate with `line-clamp-2` and a `title` attribute for the full list to keep the tooltip compact.

For the markers' tooltip, "papers" already means the paper *titles* set/marked for that class, which is what the user asked for. For setters', same idea.

---

## Files touched

- `src/routes/oversight.tsx` — KPI source change, realtime hook, `classBreakdown` shape, `ClassBreakdownTable` rendering.
- One migration to enable realtime on `marking_papers` and `marking_deployments`.

## Out of scope

- No changes to filters, the deployment table, the `Scripts by level` table, or any data writes.
- No new components; `ClassBreakdownTable` is updated in place.
