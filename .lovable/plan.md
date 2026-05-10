## Goal

On the Oversight ("Dashboard") page, let users edit deployment details inline after the deployment file has been uploaded — no need to re-import the sheet for small contingency changes.

## What becomes editable per row

In the **Marker deployments** table (`/oversight`), each row gets four inline-editable fields:

1. **Setter** — text input. Updates the `teacher_name` on the setter deployment(s) for that paper.
2. **Marker** — text input. Updates `teacher_name` on the marker deployment row.
3. **Paper status** — new dropdown: `Setting` / `Editing` / `Vetting` / `Cleared`. Stored on `marking_papers`.
4. **Marking status** — dropdown: `Marking` / `Moderating` / `Marked`. Stored on `marking_deployments.status`.

Each field saves on blur / select-change with a small toast confirmation. No "Save" button — fully inline.

## Data model changes

Add one column:
- `marking_papers.paper_status` text, default `'setting'`, allowed values `setting | editing | vetting | cleared`.

Map the new "Marking status" dropdown to existing `marking_deployments.status` values:
- Marking → `in_progress`
- Moderating → `marking_done`
- Marked → `moderated`

(`assigned` stays as the initial state from import; the dropdown shows "Marking" for both `assigned` and `in_progress` to keep things simple, and writing "Marking" sets `in_progress`.)

## UI changes (`src/routes/oversight.tsx`)

- Replace the Setter/Marker `<TableCell>` text with a small inline `<Input>` that writes back to the relevant deployment row(s) on blur.
- Replace the `StatusBadge` cell with the **Marking status** `<Select>`. Add a new **Paper status** column with its own `<Select>`.
- All edits route through helpers `updatePaperStatus(paperId, value)`, `updateDeploymentStatus(deploymentId, value)`, `updateMarker(deploymentId, name)`, `updateSetter(paperId, name)` that call `supabase.from(...).update(...)` and update local state optimistically.
- Setter edit policy: if the paper has multiple setter rows, the inline edit replaces the comma-joined list with a single setter row (simplest sensible behaviour); we can refine to per-setter chips later if needed.
- Permissions: gated by the existing `useRoles()` check already on the page.

## Open questions

1. **Marking status mapping** — confirm Marking=`in_progress`, Moderating=`marking_done`, Marked=`moderated`. Or do you want four options including a separate "Assigned"?
2. **Setter editing** — for papers with multiple setters today (comma-joined), is collapsing to a single editable name acceptable, or should we keep multi-setter editing (one row per setter)?
3. **Who can edit** — anyone who can see Oversight, or restricted to SL / HOD only?
