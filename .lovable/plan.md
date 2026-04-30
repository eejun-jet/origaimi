## Goal

When a user uploads a past paper, the AI parser should split it into individual reusable bank items — each with its own stem, sub-parts, marks, command word, accompanying diagrams, source/stimulus excerpts, and full syllabus tagging (Knowledge Outcome / Learning Outcome / Assessment Objective). Those items then appear as filterable, searchable rows on the `/bank` page and become available to pull into the Assessment Builder.

## How it will work end-to-end

1. **User uploads paper** on `/papers` (already works). They tag subject + level + year + paper number, and optionally pick a syllabus.
2. **`parse-paper` edge function** (extended) runs once per paper and:
   a. Extracts every numbered question + sub-part verbatim (stem, marks, command word) — already partly done.
   b. **NEW:** Detects per-question stimulus/source material (passage, data table, equation, source A/B excerpts) and stores it as `source_excerpt` per question.
   c. **NEW:** Links each detected diagram to the specific question(s) that reference it (instead of only to a page).
   d. **NEW:** A second AI pass classifies each question against the chosen syllabus's `syllabus_topics` — picks topic_code, learning_outcome codes, knowledge outcomes, AO codes, and Bloom level. If no syllabus is selected, falls back to free-text topic tags.
   e. Inserts each question (and each substantive sub-part) as a row in `question_bank_items` with `source = 'past_paper'` and rich tags.
3. **`/bank` page** is upgraded with filters (subject, level, syllabus, topic, KO/LO, AO, source, year, marks, command word, question type) and full-text search. Each card shows the stem, attached diagram(s), source excerpt, and tags. Clicking a row reveals full detail + "use in new assessment".
4. **Assessment Builder** gets a new "Pull from bank" affordance so generated papers can mix bank items with freshly generated ones (deferred wiring detail — surfaced as a button that filters bank items by current subject/level/syllabus).

## Technical changes

### Database (one migration)

Extend `question_bank_items` so each row can be a real past-paper question with attachments and full tagging:

- `past_paper_id uuid` — link back to source paper (nullable for AI/manual items)
- `question_number text` — e.g. "3a(ii)"
- `command_word text`
- `source_excerpt text` — passage / source / data block tied to the question
- `diagram_paths text[]` — array of `diagrams` bucket keys for this question
- `learning_outcomes text[]` — LO codes (e.g. `7.2.1`)
- `knowledge_outcomes text[]` — KO codes
- `ao_codes text[]` — Assessment Objective codes
- `syllabus_doc_id uuid` — which syllabus this is mapped against
- `topic_code text` — canonical syllabus topic code
- `year int`, `paper_number text`, `exam_board text` — provenance
- Index on `(subject, level, syllabus_doc_id)` and GIN on `learning_outcomes`, `knowledge_outcomes`, `ao_codes`, `tags` for filter speed.
- RLS: keep existing trial-open policies (consistent with rest of project).

Also add `question_id uuid` to `past_paper_diagrams` so a diagram can be tied to a specific extracted question rather than just a page.

### `supabase/functions/parse-paper/index.ts`

- Expand the `save_paper_index` tool schema so each question now also returns:
  - `command_word`, `marks`
  - `source_excerpt` (verbatim source/stimulus tied to the question)
  - `figure_refs` (list of figure indices the question depends on)
  - `question_type` (mcq / structured / essay / source-based / data-response)
  - `difficulty_hint`
- After the figure rendering loop, build a map `figureIndex -> diagrams.image_path` so we can attach diagram paths to each question.
- Add a **second AI call** (`classify-questions`) that takes the extracted questions plus the relevant syllabus's `syllabus_topics` rows (topic_code, title, learning_outcome_code, learning_outcomes, ao_codes) and returns per-question: `topic_code`, `learning_outcomes[]`, `knowledge_outcomes[]`, `ao_codes[]`, `bloom_level`. If `syllabus_doc_id` is null on the paper, skip and store free-text tags.
- Insert one `question_bank_items` row per question (and per non-trivial sub-part), with `source = 'past_paper'`, all tags, attached `diagram_paths`, `source_excerpt`, and provenance. Idempotent: delete existing past-paper bank rows for this `past_paper_id` before re-inserting (so re-parse stays clean).
- Keep existing behaviour (style summary, figures, questions_json on the paper) intact so the generator's exemplar-anchoring continues to work.

### Frontend

- `src/routes/bank.tsx`: rebuild as a filterable list.
  - Filter rail: subject, level, syllabus, topic, KO/LO, AO, source (mine / past_paper / ai), year, marks range, command word, question type.
  - Search box (stem + topic + source excerpt).
  - Item card: badges for subject/level/topic/LO/KO/AO/Bloom/marks, the stem, a "Source" expandable showing `source_excerpt` if any, and inline preview of attached diagrams (signed URLs from `diagrams` bucket).
  - "View full" drawer with provenance (paper title, year, paper #, question number) and a "Use in new assessment" action that deep-links to `/new` with the item pre-selected.
- `src/routes/papers.tsx`: after a successful parse, show a "X questions added to bank" badge and a "View in bank" link filtered to that paper.
- Restore the `/bank` link in `AppHeader` and dashboard (we removed it earlier; with real content it's worth bringing back). Rename the page from "Curated Inspiration" to "Question bank".

### Failure modes handled

- Paper has no syllabus selected → bank items still get created with free-text topic tags; KO/LO/AO arrays stay empty. UI shows "Untagged — link a syllabus to auto-tag".
- Classifier AI fails or times out → questions are inserted with free-text topic only; a "Re-tag" button on the paper re-runs just the classifier.
- Diagram render fails → fallback to PDF reference (existing behaviour) and the bank item shows a "diagram unavailable" placeholder.
- Re-parse → previous past-paper bank rows for that paper are deleted first, so no duplicates.

## Out of scope for this pass (call out so user can decide)

- Pulling bank items into the Assessment Builder (the "Use from bank" flow in `/new`) — I'll wire the button + deep-link, but full mix-and-match generation can be a follow-up.
- Manual editing of extracted questions in the bank.
- Bulk re-tagging across many papers at once.

## Deliverables

- 1 migration (schema additions + indexes).
- Updated `parse-paper` edge function with classifier pass and bank-item fan-out.
- New filterable `/bank` page with diagrams + source excerpts.
- Restored nav link, papers page badge linking to bank.