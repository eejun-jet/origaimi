Three fixes for the Authentic Assessment ("WA") flow.

## 1. SoW upload returns an error

Logs show no rows for `extract-sow-text` recently, but the function uses Gemini chat-completions with `image_url: data:<mime>;base64,...`. That works for PDFs but not for `.docx` (the model rejects non-image/non-PDF MIME), and large PDFs sometimes fail because the whole base64 file is JSON-posted in one shot.

Fix:

- For PDFs: keep the inline base64 path but reduce the size cap to 16 MB and switch the message to a `file`-typed part where supported, falling back to `image_url`. Surface the AI gateway error body in the response so the client can show why it failed (currently we just say "Extraction failed").
- For DOCX: don't send to Gemini. Add a tiny in-function DOCX reader (unzip the docx in-memory using `JSZip` from esm.sh and concat the text from `word/document.xml`, stripping XML tags). Return the resulting text. This avoids the 502 entirely.
- Client (`authentic.new.tsx`): bubble up the function's error message in the toast instead of the generic "Upload failed" so future failures are diagnosable.

## 2. Idea generation produces nothing

Edge logs show: Google AI returns 400 — *"The specified schema produces a constraint that has too many states for serving"*. The current `submit_ideas` tool schema is too large (deep nested rubric + milestones + 6 string enums + min/max array bounds).

Fix in `generate-authentic-ideas/index.ts`:

- Drop `minItems`/`maxItems` on every array.
- Remove the `enum` on `mode` (validate in code on insert).
- Flatten rubric: `rubric` becomes `array<{ criterion: string; levels: array<string> }>` — one string per level instead of `{label, descriptor}` (we re-split client-side, or just render the string).
- Drop `additionalProperties: false` everywhere (also a Gemini gotcha).
- Reduce `required` to the minimum: `mode, title, brief`.
- Lower target to **5–8 ideas** in the system prompt (user said 5 is fine), and ask for at least 4 distinct modes.
- Add a one-shot retry without the `tools` array using plain JSON-mode (`response_format: json_object`) if the structured call still 400s, so we degrade gracefully.
- Persist `parse_error` style info on the plan (`status='failed'`, write the AI error text into `notes`) so the detail page can show "Generation failed: …" instead of a silent empty state.

`authentic.$id.tsx`: when `plan.status === 'failed'`, show the stored error and a Retry button (already wired to `runGenerate`).

## 3. Building stage: let teachers pick KOs / LOs to align with syllabus

Right now ideas carry `knowledge_outcomes` / `learning_outcomes` as free-text strings the model invented. Teachers should be able to **pick** from the actual syllabus KOs/LOs of the chosen `syllabus_doc_id`.

Plan:

- In `IdeaDetail` (Sheet on `authentic.$id.tsx`), when the parent plan has a `syllabus_doc_id`, load `syllabus_topics` for that doc once (cached on the page) and group them by `strand` → KO, with their `learning_outcomes[]` as LOs.
- Add a new "Syllabus alignment" section above the rubric:
  - Two-column tag picker. Left = KOs (one chip per `strand` / top-level topic). Right = LOs (chips, filtered by selected KOs).
  - Pre-select chips matching the model's suggested `knowledge_outcomes` / `learning_outcomes` strings via case-insensitive contains match.
  - "Save alignment" button writes the selected KOs/LOs back to `authentic_ideas.knowledge_outcomes` / `learning_outcomes`.
- On the tile (`IdeaTile`), surface count badges: e.g. "3 KOs · 5 LOs" so teachers see at a glance which ideas are aligned.
- If no `syllabus_doc_id` is set on the plan, show an inline note "Pick a syllabus on the plan to enable KO/LO alignment" and a small dropdown to set it (updates `authentic_plans.syllabus_doc_id`).

## Files to edit

- `supabase/functions/extract-sow-text/index.ts` — DOCX branch + better errors
- `supabase/functions/generate-authentic-ideas/index.ts` — simpler tool schema, JSON-mode fallback, persist failure
- `src/routes/authentic.new.tsx` — surface upload error
- `src/routes/authentic.$id.tsx` — failed-state UI, KO/LO picker section, alignment counts on tiles

No DB migrations or new dependencies (JSZip via esm.sh in the edge function only).