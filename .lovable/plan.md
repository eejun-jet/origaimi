Make the dashboard charts respond to all four filters (Search, Subject, Year, Assessment, Status) on `/oversight`. Currently only Year + Assessment affect the charts; Subject and Status only filter the "Marker deployments" table.

**File:** `src/routes/oversight.tsx` only — presentation/derivation logic. No DB or schema changes.

### 1. Extend `paperPasses` to include Subject
Add subject check so it gates `visibleDeployments` (which feeds every chart):
```ts
if (subjectFilter !== "all" && (p.subject ?? "") !== subjectFilter) return false;
```
Update the `useMemo` deps for `visibleDeployments` to include `subjectFilter`.

### 2. Apply Status + Search to marker-derived charts
Status and free-text search are marker-specific (setters have no `status`, and search matches teacher/class/paper text). Replace the current `markerDeployments` memo with a filtered version so the charts that read from it react to those filters too:

```ts
const markerDeployments = useMemo(() => {
  return visibleDeployments.filter((d) => {
    if (d.role !== "marker") return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (search) {
      const p = paperById.get(d.paper_id);
      const hay = `${p?.title ?? ""} ${p?.subject ?? ""} ${p?.level ?? ""} ${d.teacher_name ?? ""} ${d.class_label ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
}, [visibleDeployments, paperById, statusFilter, search]);
```

This means the following all react to Subject/Year/Assessment/Status/Search:
- KPI strip (Markers deployed, Scripts assigned, % complete, Overdue/Flagged)
- "Scripts by level" chart (`byLevel`)
- "Scripts assigned per marker" bar chart (`perMarker`)
- "Marker deployments" table (`filtered` — simplify since redundant filters now live upstream)

### 3. Setter chart (Setting load)
`setterDeployments` already derives from `visibleDeployments`, so adding Subject to step 1 makes the "Setting load (points)" bar chart react to Subject/Year/Assessment automatically. Status and free-text search do not apply to setters (no status field; search is teacher/class oriented) — leave them out for that chart, which matches the intent of those filters.

### 4. Simplify the table memo
Since `markerDeployments` now already incorporates status + search + subject + year + assessment, the existing `filtered` memo can be reduced to just `markerDeployments` (or removed and the table can read `markerDeployments` directly). Keep the variable name to minimize churn.

### Out of scope
- "Uploaded imports" card stays unfiltered (it lists raw imports).
- No new filter UI; existing controls just gain reach.
