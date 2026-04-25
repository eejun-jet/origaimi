# Fix Objectives step: drop duplicate KO buckets, reorder AO → LO → KO

## What's wrong today

In Step 3 ("Objectives") of `/new`, after the user has already picked **Knowledge Outcomes (KO statements)** from each topic in Step 2, the wizard shows a second, hardcoded **"Knowledge Outcomes (KOs)"** card with a fixed list of 4 buckets — *Knowledge / Understanding / Application / Skills*. This is:

- **Duplicate** — the per-topic KOs are already captured (each topic carries its `outcome_categories`), so this second selector adds noise.
- **Wrong for History** — the History syllabus uses *knowledge / skills / values / attitudes*, not the 4 generic Bloom-style buckets.
- **In the wrong order** — KOs appear *between* AOs and LOs, but the user wants AOs → LOs → KOs (filtered from the topic-derived KOs).

The same fixed-bucket KO chip-row is repeated inside every per-section card in Step 4.

## What we'll change

### 1. Step 3 — Objectives panel reordering and rebuild

- **Remove** the hardcoded "Knowledge Outcomes (KOs)" card with the 4 fixed buckets (Knowledge / Understanding / Application / Skills).
- **Reorder** the panel to:
  1. **Assessment Objectives (AOs)** — unchanged
  2. **Learning Outcomes (LOs)** — unchanged (already derived from selected topics + custom-add)
  3. **Knowledge Outcomes (KOs)** — *new* card, populated from the **outcome_categories** of the topics actually selected in Step 2. Empty state: a one-line message saying "No KOs derived from the chosen topics — they'll be inferred from the topic metadata at generation time."

### 2. Step 4 — per-section card

- Replace the "always show 4 fixed KO chips" row with the **same filtered list** the global panel produces, intersected with KOs that appear on that section's `topic_pool`. If a section's pool has no KOs, hide the KO chip-row for that section.

### 3. Keep data flow & generator behaviour

- Continue saving `selectedKos` to `assessments.blueprint[].knowledge_outcomes` and section-level `knowledge_outcomes`, so the edge function (`generate-assessment`) doesn't change.
- Validation in Step 3 stays the same (at least one of AO/KO/LO selected, or skippable).

## Technical notes

Files touched:

- `src/routes/new.tsx`
  - Remove the "Knowledge Outcomes (KOs)" `<div className="rounded-lg border ...">` block (lines ~817–846) and re-insert a similar block **after** the LO block, sourced from `availableKos` (already computed from selected topics' `outcomeCategories` — needs to be widened to surface *all* topic-derived categories, not just intersected with `KNOWLEDGE_OUTCOMES`).
  - Update `availableKos` (lines ~262–277) to return the **deduped union of `outcomeCategories` across selected topics**, no longer filtered against the hardcoded `KNOWLEDGE_OUTCOMES` constant.
  - Update the reset effect (line ~283) to filter `selectedKos` against the new dynamic `availableKos`.
  - In `SectionCard` (line ~1414), replace `const koCandidates = KNOWLEDGE_OUTCOMES;` with the union of `outcome_categories` across the section's `topic_pool`. Hide the KO row when empty.
  - Drop the now-unused `KNOWLEDGE_OUTCOMES` import (keep the type import if `assessment.$id.tsx` still needs it — that file is unaffected by this change).

No DB migration. No edge-function change. No new dependencies.

## Out of scope

- Changing how the History syllabus stores KOs (the `outcome_categories` data is already correct).
- Touching the assessment review page (`/assessment/$id`).
- Renaming "Knowledge Outcomes" to "Knowledge / Skills / Values / Attitudes" — the heading stays "Knowledge Outcomes (KOs)" and the chips show whatever the syllabus defines (so History naturally shows knowledge/skills/values/attitudes, Science shows its own set, etc.).
