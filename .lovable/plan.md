## Goal

Sharpen the Assessment Coach so teachers get **specific, syllabus-grounded, evidence-based** guidance on alignment, question style, pitch, and variety — without making the panel chatty or preachy. Today the Coach reads the snapshot + syllabus aims/rationale/command words. It does not look at the syllabus AO weighting table, the question bank of past papers, or the previously generated questions in the same paper. That's the headroom.

## What the Coach can say better today

1. **Syllabus alignment — beyond aims text**
   - Pull the **AO weighting table** (e.g. SS TLS: AO‑A ~50%, AO‑B ~50%, AO‑C practical-only) directly from `syllabus_documents` and feed it to the Coach as a *target distribution*, then compare against the teacher's planned AO mix from `sections[].ao_codes × marks`.
   - Surface deltas as concrete one-liners: *"Plan is ~75% AO‑A vs syllabus target ~50%. Consider shifting one structured question to AO‑B."*
   - Pull `syllabus_topics.outcome_categories` (KO bands) so coverage feedback names the missing band rather than a vague "narrow coverage".
   - For multi-discipline syllabi (Combined Science), check **per-discipline balance** — flag if Biology has 0 marks while Physics+Chem dominate.

2. **Pitching (difficulty calibration)**
   - Use `question_bank_items` (past papers already classified to this syllabus) as a **difficulty anchor**: median marks-per-command-word, command-word frequency, and Bloom mix at this level.
   - Compare the planned section mix (command words × marks × Bloom hints) against that anchor and flag drift: *"Your Paper 2 looks lighter on 'explain/justify' than the typical N(A)-level paper at this level."*
   - Post-generation: re-run the same anchor against the drafted questions for "this draft pitches one band easier than past papers" cues.

3. **Question style & variety**
   - Compute a **style fingerprint** of the plan/draft: command-word diversity, stimulus types (text, data table, source extract, diagram), context types (familiar / unfamiliar / Singapore / global), and item formats (MCQ, short, structured, essay/source).
   - Coach calls out low-diversity patterns (e.g. *"5 of 6 stems start with 'state' or 'describe' — consider one 'evaluate' or 'compare'"*).
   - For source-based subjects (SS, History, English comprehension) — flag missing source-skill verbs (infer, compare sources, assess reliability) when AO‑B is targeted.
   - Pull a small **exemplar set** (1–2 past-paper question stems matching the LO) into the chat context so the Coach can say *"a typical SS SBQ on this LO uses two contrasting sources"* instead of generic style advice.

4. **Pre vs post coaching split**
   - **Pre** (intent): focus on *plan* — AO/KO/LO coverage vs syllabus targets, pitch target, intended variety.
   - **Post** (review): focus on *draft* — actual command-word/Bloom/stimulus distribution, repeated stems, cognitive plateau, pitch drift, alignment of each Q's tagged LO/AO to its stem.
   - Add a third category bucket — **`pitch`** and **`style`** — alongside existing `ao_balance`, `coverage`, etc., so chips are scannable.

5. **Deterministic signals (free, instant, no AI calls)**
   Extend `src/lib/intent-coach.ts` so the cheap layer already covers:
   - AO-target delta (needs syllabus weighting in snapshot).
   - Per-discipline mark balance for Combined Science / multi-paper syllabi.
   - Command-word concentration (>60% one verb).
   - Stimulus-type concentration (all text-only when syllabus expects data/source work).
   - Bloom plateau (only 'remember/understand' for an AO‑B-heavy paper).
   - Pitch hint vs syllabus level (e.g. only 1-mark items in an O-Level paper).

6. **AI layer upgrades (`coach-intent` + `coach-chat`)**
   - Inject **AO weighting table + per-AO description**, **command-word glossary in full**, **top KO bands**, and a **5-stem exemplar excerpt** from `question_bank_items` for the same syllabus/level.
   - Add explicit `pitch_target` and `style_target` fields to the tool schema so suggestions are categorised cleanly.
   - Tighten the system prompt with the new categories and examples ("Two of three sections lean on 'state' — consider…").
   - Keep the "silence is better than noise" rule; cap at 3 obs / 2 suggestions.

7. **UI affordances in `BuilderCoachPanel`**
   - Add a compact **"Alignment snapshot"** strip above signals: target-vs-plan AO bars (e.g. AO‑A 50% target / 72% plan) — click to expand for KO bands. Read-only, no nagging.
   - Add a **"Style snapshot"** chip row: command-word diversity, format mix, stimulus mix.
   - Group AI observations under labelled sub-headers: Alignment · Pitch · Style · Coverage. Same sparse cap.
   - Starter prompts updated: *"Is the pitch right for this level?"*, *"Make the style more varied."*, *"Show me the AO target vs my plan."*

## Technical notes (for the engineer)

- `BuilderSnapshot` already carries `paperAOs` with `weightingPercent`. The deterministic AO-delta check just needs to read that and compute `planned% − target%` from `sections[].ao_codes × marks`.
- `coach-intent` and `coach-chat` should select additional columns: `syllabus_documents.ao_weighting_table` (already used elsewhere via `paperAOs`) and `syllabus_topics.outcome_categories`. For exemplars: `question_bank_items` filtered by `syllabus_doc_id`, top 5 by recency or matching LO.
- New deterministic helpers go in `src/lib/intent-coach.ts`. Push exemplar fetching server-side (in `coach-intent`) to avoid bloating client snapshots.
- Add two new `category` enum values — `pitch`, `style` — to both the tool schema in `coach-intent` and the `IntentSignal["category"]` type. Update the chip renderer to colour them distinctly.
- Keep existing pre/post split, streaming, apply-to-instructions affordance, and the silence default.

## Out of scope (not changing here)

- Generation pipeline (`generate-assessment`) — the Coach only advises.
- Auto-applying suggestions; teacher always clicks Apply.
- Adding a new model dependency — reuse Lovable AI Gateway models already wired.
