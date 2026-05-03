## Goal

Extract syllabus aims, rationale, pedagogical/assessment intent, and command-word guidance from the uploaded **Combined Humanities (SS + History) 2261** PDF and attach this narrative context to the existing `syllabus_documents` row, so the Assessment Intent Coach and Review Coach reason with richer subject context. Existing AOs, KOs, LOs, and SOs (which match your earlier xlsx upload) will not be touched.

## Why a narrative-only re-parse

The current `parse-syllabus` function rebuilds papers + topics + AOs from scratch. Re-running it would overwrite the AO/KO/LO/SO structure you carefully ingested. Instead, we add a separate, narrative-only extraction pass that writes only to new columns on `syllabus_documents`.

## Changes

### 1. Schema (migration)
Add narrative columns to `syllabus_documents` (all nullable, default null):
- `aims text` — overall syllabus aims
- `assessment_rationale text` — what the paper is trying to measure / philosophy of assessment
- `pedagogical_notes text` — teaching/learning approach, inquiry-based notes, skills emphasis
- `command_word_glossary jsonb` — array of `{ word, definition }` from the syllabus's command-word table if present
- `narrative_source_doc_id uuid` — which uploaded PDF the narrative was extracted from (audit trail)

Subject/level/AO/KO/LO/SO columns remain untouched.

### 2. New edge function `extract-syllabus-narrative`
- Accepts `{ documentId, filePath }` (filePath optional — re-uses storage path if absent, or accepts a freshly uploaded PDF in the `syllabus-narratives` storage area).
- Downloads the PDF, sends it to `google/gemini-2.5-pro` via Lovable AI Gateway with a tool-call schema that returns ONLY:
  - `aims`, `assessment_rationale`, `pedagogical_notes`, `command_word_glossary[]`
- Writes the result into the four new columns on the existing `syllabus_documents` row.
- Does NOT touch `syllabus_papers`, `syllabus_topics`, `syllabus_assessment_objectives`, or `skills_outcomes`.

### 3. One-off run for 2261
Upload `Comb_Hist_TLS_2261_y26_sy-3.pdf` into the `syllabi` bucket and invoke `extract-syllabus-narrative` for `id = 51ed087a-c0bc-4c94-ac32-e676095b9796` (Combined Humanities History 2261). Same can be re-run later for 2260/2262 if you upload those.

### 4. Wire narrative into coaches
- `coach-intent/index.ts`: when `assessment.syllabus_doc_id` is set, fetch `aims`, `assessment_rationale`, `pedagogical_notes`, top 6 command-words and inject them into the system prompt as a "Syllabus context" block. The coach is instructed to use these for tone/intent grounding only — not to invent topic codes.
- `coach-review/index.ts`: same injection into the review prompt so post-generation feedback references the syllabus's stated assessment intent.

### 5. Admin UI surfacing (read-only)
In `src/routes/admin.syllabus.$id.tsx`, render a collapsed "Syllabus narrative" card showing the four new fields when present, with a "Re-extract narrative" button that triggers the new edge function. No edits required — it's auxiliary context.

## Files

- new migration: add columns to `syllabus_documents`
- new: `supabase/functions/extract-syllabus-narrative/index.ts`
- edited: `supabase/functions/coach-intent/index.ts`
- edited: `supabase/functions/coach-review/index.ts`
- edited: `src/routes/admin.syllabus.$id.tsx`

## Out of scope

- Re-running `parse-syllabus` (would overwrite your AO/KO/LO/SO).
- Schema changes to `syllabus_topics`, `syllabus_papers`, `syllabus_assessment_objectives`.
- Combined Science / English / other subjects — only 2261 is targeted in this loop, but the function works for any document id.
