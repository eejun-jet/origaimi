

## Add Assessment Objectives (AOs) + outcome categorisation across all syllabuses

Right now the parser only pulls topics + learning outcomes. MOE/SEAB syllabuses also publish a separate **Assessment Objectives** section (e.g. "AO1: Knowledge with Understanding", "AO2: Application", "AO3: Analysis") and most newer syllabuses tag each learning outcome as **Knowledge / Skills / Values** (esp. Humanities, Combined Sci, Character & Citizenship). Surfacing these lets teachers verify construct validity ("does my paper hit AO1/2/3 in the right weighting? am I over-testing knowledge and under-testing values?").

### What you'll get

1. **AOs panel** on every syllabus review page — code, title, description, weighting % per paper, source quote.
2. **Outcome tagging** on every learning outcome: `knowledge | skills | values | attitudes` (multi-tag allowed; defaults to `knowledge` when the syllabus doesn't say).
3. **AO coverage chip** in the wizard's blueprint step — live bar showing AO1/AO2/AO3 distribution + K/S/V mix as the teacher selects topics and assigns marks.
4. **Construct validity warning** if the blueprint leaves any AO at 0% (or wildly off the syllabus's published weighting).

### Plan

**1. Schema additions** (one migration)

- New table `syllabus_assessment_objectives`:
  - `id, source_doc_id, paper_id (nullable — null = applies to all papers in doc), code (e.g. "AO1"), title, description, weighting_percent, position`
  - RLS: trial-open like sibling syllabus tables.
- Extend `syllabus_topics`:
  - `outcome_categories text[]` default `{}` (values: `knowledge`, `skills`, `values`, `attitudes`)
  - `ao_codes text[]` default `{}` (e.g. `{AO1, AO2}`) — which AOs each learning outcome maps to.

**2. Parser upgrade** (`parse-syllabus` edge function)

- Extend the `save_syllabus` tool schema with:
  - `assessment_objectives[]`: `{ paper_number|null, code, title, description, weighting_percent }`
  - `topics[].outcome_categories`: enum array
  - `topics[].ao_codes`: string array
- Beef up the system prompt with a dedicated AO section: "Locate the 'Assessment Objectives' section… capture AO1/AO2/AO3 verbatim with their descriptors and any weighting table per paper. For each topic's learning outcomes, classify each as knowledge/skills/values/attitudes based on verbs ('state/define' → knowledge; 'analyse/evaluate/draw/calculate' → skills; 'appreciate/respect/value' → values)."
- Insert AOs into the new table after papers are inserted; map by `paper_number` like topics.
- Re-run parser across all 16 syllabuses (small script, sequential, ~30s each).

**3. Review UI** (`/admin/syllabus/$id`)

- New "Assessment Objectives" card above the topics list, scoped to the active paper tab. Editable rows (code, title, description, weighting).
- In each topic row, show small chips for `outcome_categories` + `ao_codes`; click to toggle/edit.

**4. Wizard upgrade** (`/new` step 3 — Blueprint)

- Add `ao_codes` + `outcome_categories` to `BlueprintRow` (carried from the picked topic).
- Render an **AO Coverage** strip below the marks total: stacked bar AO1/AO2/AO3 (computed from blueprint marks × the topic's AO mapping; if topic has no AOs, marks count toward "Unmapped").
- Render a **K/S/V Coverage** strip alongside it.
- Show a soft warning if AOs published for the paper aren't all represented, or if marks distribution deviates >15% from the syllabus's published AO weighting.

**5. Generator awareness** (`generate-assessment`)

- Pass `ao_codes` + `outcome_categories` into the prompt per blueprint row so the AI is told which AO each item must address. Already wired through `BlueprintRow`; just extend the interface and prompt builder line.

### Out of scope (deliberately)

- No automatic re-balancing of the blueprint — teacher remains in control; we only flag.
- No retroactive editing of already-generated assessments — AOs only affect new drafts.

### Notes / risks

- Some syllabuses (Foundation Maths, PSLE Math) don't publish AOs as a separate section — parser will gracefully emit an empty array and the UI will hide the panel.
- Outcome categorisation in older syllabuses is heuristic (verb-based); admin can hand-correct in the review page.
- Re-parsing all 16 docs costs ~16 Lovable AI Gateway calls on `gemini-2.5-pro`. Cheap, but worth flagging.

