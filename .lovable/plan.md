## Goal

In the Assessment Coach sidebar, the **LO Coverage** card currently renders every Learning Outcome as one long flat list. On real papers this becomes 30–60 lines of fine print and feels daunting.

Switch the default to a **KO-grouped view**: one row per Knowledge Outcome showing `covered / total` LOs and a status pill, with the underlying LOs hidden inside a collapsible that the teacher can expand (click / double-tap) when they want the detail.

## What changes

In `src/routes/assessment.$id.tsx`, inside the **LO Coverage** `CollapsibleCard` (around line 2887–2990):

1. **Default rendering** — when `paper.los.length > 0` and we're NOT in the science `loView === "topic" | "map"` branch, replace the current flat `<ul>` (lines 2968–2989) with a list of KO rows built from the existing `koLoGroups` memo (already defined at line 2667 — no new computation needed).

2. **Each KO row** is a shadcn `Collapsible`:
   - **Trigger (always visible):** KO name · `coveredLOs / totalLOs` LOs · status pill (reuse `STATUS_META` colors already used in the Coverage Explorer) · chevron that rotates on open · remark pill if any coverage comment is attached to the KO.
   - **Content (expanded):** the same per-LO buttons that exist today (`✓` / `○`, click → `setTarget({ kind: "lo", ... })`, remark pill), just nested under the KO.

3. **Sort** KOs by status (uncovered → partial → covered) then alphabetically — `koLoGroups` already does this.

4. **Card description / summary** stay as-is (`X / Y learning outcomes covered`) so the headline metric is unchanged.

5. **Science papers**: keep the existing `By topic` / `Map` / `Flat list` toggle untouched. The new KO-grouped layout becomes the default for the **Flat list** mode (or we rename that tab to **By KO** since it's no longer flat — minor copy change).

6. **Rename the toggle option**: `Flat list` → `By KO` for clarity. Non-science subjects don't see the toggle, they just get the KO-grouped view.

## UX detail

- Default state: all KO rows **collapsed**. The teacher sees ~5–15 rows instead of 30–60 lines.
- One click on a row toggles it. Multiple rows can be open at once (independent `Collapsible` instances, no accordion lock-in).
- "Unassigned" KO bucket (orphan LOs already handled by `koLoGroups`) renders last, same expand behavior.
- No layout change to the surrounding card, the `Refresh LO coverage analysis` button, or the `Expand` → Coverage Explorer button.

## Files touched

- `src/routes/assessment.$id.tsx` — replace the flat LO list block (~lines 2968–2989) with the KO-grouped Collapsible list; rename one toggle label.

No new components, no new data plumbing, no schema changes — `koLoGroups`, `remarkCount`, `setTarget`, and `STATUS_META` are all already in scope in this component.
