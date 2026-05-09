## Fix Oversight import button + surface blank template

### Changes

**1. `src/routes/oversight.tsx`**
- Only render the "Import deployment sheet" button when `canSeeOversight` is true (so non-HOD users don't click into a denied screen).
- Add a secondary outline button "Download blank template" next to it, linking to `/templates/setters-markers-template.xlsx` with the `download` attribute.
- Wrap the Link's children in a single `<span>` inside `<Button asChild>` to avoid the click-swallow edge case.
- Add a one-line hint under the page subtitle: *"New here? Download the blank template, fill in your setters/markers, then import."*
- In the empty papers/deployments table state, also add a "download the blank template" link beside the existing "Import your setters/markers list" link.

**2. `src/routes/oversight.import.tsx`**
- Improve the `!canSeeOversight` early-return: explicit heading "You need HOD or School Leader access to import" + a Back to Oversight link, so the symptom can never feel like "nothing happened".

### Out of scope
- No changes to import parsing, points engine, schema, template file contents, or new routes.

### Files touched
- `src/routes/oversight.tsx`
- `src/routes/oversight.import.tsx`