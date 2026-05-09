## Goal

Restore the points/leaderboard view, make per-teacher load show **scripts assigned per teacher regardless of marking status**, and let you clean up old uploads so each new import doesn't pile on top of previous ones.

## Changes

### 1. `src/routes/oversight.tsx` — Per-teacher load → "Scripts assigned per teacher"

Replace the current per-teacher section so the headline number is **scripts assigned** (not progress %). Sorted by assigned desc.

- Columns: Teacher · Papers/classes · Scripts assigned · Marked · Flagged
- Show all teachers from marker deployments, regardless of status (already the case — the rollup uses `markerDeployments` without status filtering).
- Make it a real table, not a progress-bar list, since assigned count is the primary signal.

### 2. `src/routes/oversight.tsx` — Bring back the points/deployment-by-points card

Restore (and keep) a "Deployment by points" card showing setting + marking + moderation points per teacher (from `deployments.points` summed by `role`). This is the part you want emphasized.

- One row per teacher with three sub-bars/columns: Setting / Marking / Moderation points + total.
- Sorted by total points desc.
- Add the "Dashboard leaderboard →" link back next to the filter row, pointing at `/oversight/points`.
- Restore `totalPoints` KPI in the strip (back to 6 columns).

### 3. `src/routes/oversight.tsx` — Manage uploaded imports (delete earlier templates)

Add a new "Imports" card listing rows from `marking_imports` (filename, year/semester, papers/deployments created, created_at) with a **Delete** button per row.

Delete behavior — cascade in this order so nothing is orphaned:

1. Find all `marking_papers` linked to this import (we'll add `import_id` so we can scope the cascade — see DB change below).
2. Delete `marking_scripts` whose `deployment_id` belongs to those papers' deployments.
3. Delete `marking_deployments` for those papers.
4. Delete the `marking_papers` rows.
5. Delete the `marking_imports` row.

Also add a "Delete ALL deployment data" button (with confirm) that wipes scripts → deployments → papers → imports for the current user/department, for a clean slate.

### 4. DB change — link papers/deployments back to their import

Currently `marking_papers` has no `import_id`, so we can't cleanly remove "just the rows from upload X." Add:

- `marking_papers.import_id uuid null` (FK-style, nullable for legacy rows)
- Index on `marking_papers.import_id`

And update `src/routes/oversight.import.tsx` `commit()` to:

- Insert the `marking_imports` row first, get its id.
- Stamp `import_id` on every `marking_papers` row inserted in this run.
- Existing `marking_imports` summary update at the end stays.

Legacy rows without `import_id` will still appear on the dashboard; the per-import delete only removes rows tagged with that id. The "Delete ALL" button handles legacy cleanup.

## Out of scope

- The `/oversight/points` route and importer points logic stay as-is.
- No changes to RLS — tables already have permissive trial policies.

## Open question

Do you want the per-teacher table to show **only markers** , and a separate per-teacher table to show **only setters**. (teachers who set the papers dont neccessarily mark it, and vice versa) 