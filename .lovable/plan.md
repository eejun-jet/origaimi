## Goal

On the Oversight dashboard (`/oversight`), make two improvements to the inline editing flow in the **Marker deployments** table:

1. **Auto-refresh after edits** — when a user changes Setter, Marker, Paper status, or Marking status, the dashboard's KPIs and the row itself should reflect the change immediately, with no "Update" / reload step.
2. **Setter & Marker pickers** — replace the plain text input with a combobox: a dropdown of names already known from previous uploads, plus the ability to type a new name to override (for new staff).

## What to change (`src/routes/oversight.tsx`)

### 1. Auto-refresh on edit

Today each `updatePaperStatus` / `updateMarkingStatus` / `updateMarkerName` / `updateSetterName` updates local state optimistically, but the KPI tiles at the top (papers cleared, marking progress, etc.) appear stale to the user because the change isn't always reflected immediately, and there's no visible confirmation beyond the toast.

Plan:
- Keep optimistic local updates (instant UI), then call `load()` in the background after the Supabase write succeeds so all derived numbers (KPIs, progress bars, filters) are recomputed from authoritative server data.
- Wrap each updater so a single helper handles: optimistic change → write → background `load()` → toast. On error, revert and toast the failure.
- Remove the requirement to navigate away and back to `/oversight` (the only current way the table fully refreshes).

### 2. Setter & Marker dropdown with manual override

Build the list of known names from the data already in memory:
- `setterOptions` = unique non-empty `teacher_name` from all deployments where `role = 'setter'`, sorted alphabetically.
- `markerOptions` = unique non-empty `teacher_name` from all deployments where `role = 'marker'`.
- Union for both fields so a marker can also be picked as a setter and vice versa.

Replace the inline `<Input>` for Setter and Marker with a small **Combobox** (shadcn `Popover` + `Command`, the standard pattern already used by shadcn). Behaviour:
- Click → shows the searchable list of existing names.
- Typing filters; if no match, a "Use '<typed>'" item appears so the user can save a brand-new name (new staff).
- Selecting an option (or pressing Enter on the "Use" item) calls the existing `updateSetterName` / `updateMarkerName`.
- Empty selection clears the name (writes `null`), same as today.

Extract this into one component, e.g. `<TeacherCombobox value options onSave placeholder />`, and use it for both columns.

### 3. Minor polish

- Show a subtle "Saving…" indicator on the row being edited (greyed out while the network round-trip is in flight) so the user sees feedback even before the toast.

## Out of scope

- Realtime subscriptions (Supabase channels) for multi-user live updates — stick with reload-after-write for now; can be added later if multiple SLs edit the same dashboard concurrently.
- Persisting a separate "staff directory" table — names are still derived from past uploads.
- Changes to the `/oversight/import` flow.

## Open questions

1. For the dropdown options, should we **also include names from `profiles` / `teacher_aliases`** (registered teachers in the system), or keep it strictly to names seen in past uploads? Including profiles would surface staff who haven't yet been deployed.
2. When a user picks a known name from the dropdown, do you also want the system to **auto-link `teacher_id`** (so points roll up to that profile), or keep the link manual?
