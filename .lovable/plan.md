## Goal
Make per-question **Edit** and **Regenerate** controls more discoverable. Today they exist but live only in a footer toolbar at the bottom of each question card, which is easy to miss on long questions (especially SBQs with sources). Add a prominent inline action cluster in the question header so users always see "Edit" and "Regenerate with prompt" right next to the question number.

## What changes for the user
On every question card in the assessment view (`/assessment/:id`):
- A compact button cluster appears in the **top-right** of each question header (next to the move-up/down arrows): **Edit**, **Regenerate**.
- Clicking **Regenerate** opens the existing prompt panel (instruction box + difficulty selector + Regenerate button) directly under the question — same panel as today, just opened from the new top-level button.
- Clicking **Edit** enters the existing inline editor (stem, marks, Bloom's, answer, mark scheme).
- The existing footer toolbar (Edit / Regenerate / Save to bank / Comment / Delete) stays as-is so power users still have it; the new cluster is an additional surface, not a replacement.
- For consistency, source-based questions and questions with diagrams get the same header cluster — the existing diagram Edit/Regenerate buttons remain inline with the diagram (unchanged).

## Technical implementation
File: `src/routes/assessment.$id.tsx` (only file touched).

1. In `QuestionCard` (around the header at lines 1055–1080), extend the right-hand button group that currently holds the up/down arrows to also include:
   - `<Button size="sm" variant="outline" onClick={() => setEditing(true)}>` with a `Pencil` icon and "Edit" label
   - `<Button size="sm" variant="outline" onClick={() => setShowRegen((v) => !v)}>` with a `Sparkles` icon and "Regenerate" label (toggles the existing `showRegen` state, which already drives the prompt panel at lines 1276–1305)
2. Hide the new cluster while `editing` is true (same pattern as the footer) so it doesn't clutter the edit form.
3. On narrow viewports (<640px) collapse the labels to icon-only buttons with `aria-label` + tooltip via `title=` to avoid wrapping.
4. Import `Pencil` from `lucide-react` (already importing `Sparkles`, `RefreshCw`, etc., so just add `Pencil`).

No backend changes — the existing `regenerate-question` edge function and `regenerate()` / `onRegenerate` wiring already support both prompt-driven regeneration and difficulty targeting.

## Out of scope
- No changes to the regenerate edge function or prompt logic.
- No changes to the bulk-regenerate flow (selection + toolbar above the question list stays as-is).
- No changes to diagram Edit/Regenerate (already prominent inline with the diagram).