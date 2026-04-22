

## Goal
Let teachers click on a question's diagram to **edit it with a prompt** ("add a labelled ammeter", "remove the second beaker", "make the graph axes start at 0") or **regenerate it from scratch** at a different angle, directly from the assessment review page.

## What's there today
- Every question can already carry a diagram (`diagram_url`, `diagram_source`, `diagram_caption`).
- An edge function **`generate-diagram`** already exists and accepts an optional `instruction`. It always *generates* a brand-new image — it never *edits* the existing one.
- The assessment review UI (`src/routes/assessment.$id.tsx`) renders the figure but exposes **no controls** for it. The "Regenerate" button on the card only re-rolls the *question text*, not the diagram.

## Plan

### 1. Diagram toolbar on every figure
In `src/routes/assessment.$id.tsx`, under the existing `<figure>` (around line 765), add a small action row visible whenever a diagram is present:

```text
[ Edit with prompt ]   [ Regenerate ]   [ Remove ]
```

If the question has **no diagram yet** but is a science/maths question, also show a single `[ Generate diagram ]` button below the stem so teachers can add one on demand.

### 2. Inline prompt panel
Clicking **Edit with prompt** or **Regenerate** opens a small panel under the figure (same visual pattern as the existing question-regenerate panel):

- Textarea — placeholder differs by mode:
  - Edit: *"Describe the change — e.g. 'add a switch in series', 'relabel R₁ as 4Ω', 'shade the triangle'"*
  - Regenerate: *"Optional: 'show side view instead', 'use a Bunsen burner', 'simpler labels'"*
- Buttons: **Apply** (with spinner), **Cancel**.

### 3. Edge-function changes — `supabase/functions/generate-diagram/index.ts`
Extend the function to support **three modes** in one call:

| `mode` | Behaviour |
|---|---|
| `generate` (default, today) | Text-to-image with the MOE-style system prompt. |
| `edit` | Calls Nano Banana 2 with both the **instruction** AND the existing `diagram_url` as an `image_url` content part — image-edit mode. Preserves layout, applies only the requested change. |
| `regenerate` | Same as `generate` but accepts the user instruction to steer a fresh attempt; old image is replaced. |

Implementation notes:
- Add `mode`, `currentDiagramUrl`, plus the existing `instruction` to the request body.
- For `edit`, build a multi-part user message (`text` + `image_url`) per the AI gateway image-edit pattern; keep the same MOE black-and-white styling rules in the text part.
- Use `google/gemini-3.1-flash-image-preview` (Nano Banana 2) as the default model — fast and edit-capable. Keep `google/gemini-3-pro-image-preview` as a fallback for `regenerate` if the flash edit/generation fails.
- After upload, update `diagram_url`, set `diagram_source = 'ai_edited'` (for edits) or `'ai_generated'` (for fresh generations), and refresh `diagram_caption` only on regenerate (keep caption on edit so labels don't drift).
- Return the new `url` so the UI can swap it in immediately without a full page refetch.

### 4. Frontend wiring — `src/routes/assessment.$id.tsx`
- New helper `runDiagramAction(qId, mode, instruction)` that calls the edge function via `supabase.functions.invoke("generate-diagram", { body: { questionId, topic, subject, mode, instruction, currentDiagramUrl } })`.
- On success: update the local `questions` state with the new `diagram_url` (and source) so the figure swaps in place, plus a toast.
- On 429/402: surface friendly toasts ("Rate-limited, try again shortly" / "Out of AI credits").
- **Remove** action: simple confirm + `update assessment_questions set diagram_url=null, diagram_source=null, diagram_caption=null, diagram_citation=null`.

### 5. Where it shows
Only show diagram actions for science / maths questions (Physics, Chemistry, Biology, General/Combined Science, Mathematics). For English/Humanities the figure toolbar stays hidden.

## Files touched
```
supabase/functions/generate-diagram/index.ts   add edit/regenerate modes,
                                               image-edit multipart payload,
                                               currentDiagramUrl handling
src/routes/assessment.$id.tsx                  diagram toolbar, inline edit
                                               panel, generate-from-scratch
                                               button, remove action,
                                               state swap on success
```

No DB migration. No schema change. No new dependencies.

## Result
- Teachers can refine any diagram with natural-language prompts ("add a return spring", "make the parabola pass through the origin") and Nano Banana edits the **existing figure** in place.
- They can also re-roll a diagram with a steering instruction, generate one for a question that currently has none, or remove an unwanted figure.
- All actions stay on the same review screen — no full regenerate of the question text needed to fix a diagram.

