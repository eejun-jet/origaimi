

## Goal
Make Assessment Objectives (AOs), Knowledge Outcomes (KOs) and Learning Outcomes (LOs) **first-class** alongside topics: pick them in the builder, attach them to every question (auto + manual override), track live coverage in the editor, and gate finalisation behind an AO/KO/LO review.

## What's already there
- `syllabus_assessment_objectives` table is loaded per syllabus doc (`docAOs` in `new.tsx`).
- `syllabus_topics` already carry `learning_outcomes` (LOs), `ao_codes` (AOs), and `outcome_categories` (KOs — Knowledge / Understanding / Application / Skills).
- `SectionTopic` already passes `learning_outcomes`, `ao_codes`, `outcome_categories` to the generator.
- Generator already mentions LOs + AOs in the prompt — but **does not save them per question**. Today only `topic` and `bloom_level` survive on `assessment_questions`.

## Plan

### 1. Database — add per-question objective tracking
Single migration on `assessment_questions`:
```
ao_codes              text[]   default '{}'   -- e.g. ['AO1','AO2']
learning_outcomes     text[]   default '{}'   -- LO statements covered
knowledge_outcomes    text[]   default '{}'   -- KO categories: Knowledge|Understanding|Application|Skills
```
Add the same three to the `Section` shape (`src/lib/sections.ts`) so a section can declare a **target pool** independent of (and broader than) the per-topic defaults.

### 2. Builder — Step 2.5 "Objectives"
Insert a new step between **Topics** and **Sections** in `src/routes/new.tsx`:

```text
┌── Assessment Objectives ───────────────────────────────────┐
│ ☑ AO1  Knowledge with understanding         [25%]         │
│ ☑ AO2  Handling information & problem-solving [50%]       │
│ ☐ AO3  Experimental skills & investigations  [25%]        │
└────────────────────────────────────────────────────────────┘

┌── Knowledge Outcomes (KOs) ───────────────────────────────┐
│ ☑ Knowledge   ☑ Understanding   ☑ Application  ☐ Skills  │
└────────────────────────────────────────────────────────────┘

┌── Learning Outcomes (LOs) ────────────────────────────────┐
│ Auto-derived from your selected topics (collapsible).     │
│ ☑ State that …      ☑ Explain how …      ☐ Calculate …    │
│ [+ Add custom LO]                                          │
└────────────────────────────────────────────────────────────┘
```

- AO list = `docAOs` (already loaded). Stored as `selectedAoCodes: string[]`.
- KO list = fixed 4: Knowledge / Understanding / Application / Skills (filtered by what the chosen topics' `outcome_categories` actually cover). Stored as `selectedKos: string[]`.
- LO list = union of `learning_outcomes` from every selected topic, deduped, plus a free-text "Add custom LO" input. Stored as `selectedLos: string[]`.
- Each section card (Step 3) gets a small **"Targets for this section"** sub-panel with three multi-selects pre-populated from the global picks — teachers can narrow per section.

### 3. Generator — save objectives per question
In `supabase/functions/generate-assessment/index.ts`:
- Pass `section.ao_codes`, `section.knowledge_outcomes`, `section.learning_outcomes` (or fall back to the topic-level ones) into the prompt as an explicit "OBJECTIVES TO COVER" block, with a directive: *"Each generated question MUST list the AO codes, KO categories, and LO statements it actually addresses."*
- Extend the tool/JSON schema with `ao_codes`, `knowledge_outcomes`, `learning_outcomes` arrays per question.
- On insert (around line 932), persist those arrays. If the model omits them, fall back to the topic's defaults.

### 4. Per-question regenerate
`supabase/functions/regenerate-question/index.ts`: accept optional `target_ao_codes`, `target_kos`, `target_los` and inject them into the prompt; force the saved row to those values when supplied.

### 5. Editor — live coverage tracking (`src/routes/assessment.$id.tsx`)
Add to the right-hand sidebar (next to TOS Alignment Meter), three new compact meters:

```text
AO Coverage           KO Coverage          LO Coverage
AO1  ███████░  18/20  Knowledge  ████  8   12 / 14 covered
AO2  ████░░░░  12/30  Understand ██    3   ─ Show uncovered ▾
AO3  ░░░░░░░░   0/10  Application ███  6
                      Skills      █    1
```

- AO meter compares **marks per AO** vs the % weighting from `docAOs`.
- KO meter shows how many marks fall into each KO category vs the targets selected in Step 2.5.
- LO list shows which selected LOs are still **uncovered** by any question — clicking one filters the question list to show candidates that could be edited to cover it.
- Each `QuestionCard` gets three small editable badge rows (AO / KO / LO) so the teacher can correct mis-tagging inline; updates write straight back to `assessment_questions`.

### 6. Final review gate
Add a **"Review & finalise"** button in the editor header. Clicking opens a modal:

```text
Final review checklist
✓ All 25 questions have at least one AO   
⚠ AO3 currently 0 / 10 marks — add 1 question
✓ Every selected KO is covered
⚠ 2 LOs still uncovered: "Calculate the resultant force…", "Define momentum"
─────────────────────────────────────────────────
[ Mark as final ]   (disabled until all ⚠ resolved or overridden)
```

- "Mark as final" sets `assessments.status = 'final'` and stores a snapshot in `assessment_versions` so the user has an audit trail.
- A "Override and finalise anyway" link lets teachers proceed with a one-line justification (saved in `assessment_versions.label`).

### 7. Custom user-defined objectives
For schools that don't use a parsed syllabus (or want bespoke targets), Step 2.5 also exposes a **"+ Add custom AO / KO / LO"** input on each section. Custom items are stored verbatim in the same arrays — generator and review treat them identically.

## Files touched
```
supabase/migrations/<new>.sql                    add ao_codes / learning_outcomes / knowledge_outcomes to assessment_questions
src/lib/sections.ts                              Section gets ao_codes, knowledge_outcomes, learning_outcomes
src/routes/new.tsx                               new Step 2.5 "Objectives", per-section targets sub-panel, custom-objective inputs
src/routes/assessment.$id.tsx                    AO/KO/LO meters, per-question editable badges, "Review & finalise" modal
supabase/functions/generate-assessment/index.ts  emit + persist per-question objectives; richer prompt
supabase/functions/regenerate-question/index.ts  accept target objectives on regen
```

No new dependencies. AOs are already loaded; KOs / LOs piggyback on existing topic metadata.

## Result
- Teachers explicitly choose the AOs, KOs and LOs the paper must hit.
- Every generated question is tagged (and editable) with the objectives it addresses.
- A live coverage panel shows exactly what's hit, what's underweight, and what's still uncovered.
- Finalising is gated on a single review modal that confirms the paper actually delivers on the declared objectives.

