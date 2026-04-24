## Goal
Today Step 3 picks **global** AOs / KOs / LOs and each section card only shows them as **read-only chips with an × to drop**. There's no way to *add* an objective back to a single section, or to give different sections different objective coverage. Make every section's AO / KO / LO list **fully editable and independent**, so e.g. Section A covers AO1+AO2 (Knowledge / Understanding), Section B covers AO2+AO3 (Application / Skills), and each can target a different subset of LOs.

## Plan

### 1. SectionCard becomes the source of truth for per-section objectives
In `src/routes/new.tsx`, replace the existing read-only "Inherited from Step 3 — × to drop" panel inside `SectionCard` (lines ~1609–1655) with a proper **"Objectives for this section"** sub-panel that mirrors the Step 3 UI but scoped to the section.

Three collapsible blocks:

```text
┌── Objectives for this section ─────────────────────────┐
│ ▾ AOs (2 / 3)                                          │
│   ☑ AO1  Knowledge with understanding                  │
│   ☑ AO2  Handling information                          │
│   ☐ AO3  Experimental skills                           │
│   [+ Add custom AO]                                    │
│                                                        │
│ ▾ KOs (3 / 4)                                          │
│   ☑ Knowledge  ☑ Understanding  ☑ Application  ☐ Skills│
│                                                        │
│ ▾ LOs (4 selected)                                     │
│   ☑ State that …                                       │
│   ☐ Explain how …                                      │
│   ☑ Calculate the resultant force …                    │
│   [+ Add custom LO]                                    │
└────────────────────────────────────────────────────────┘
```

Behaviour:
- Each checkbox toggles the value on `section.ao_codes` / `section.knowledge_outcomes` / `section.learning_outcomes` via the existing `onUpdate({...})` callback — no new state needed.
- The **candidate pool** shown in each block is the union of: (a) the global Step 3 picks, plus (b) anything already on this section, plus (c) the underlying full universe (all `docAOs`, all 4 KOs, all `derivedLos` from this section's topic_pool). That way teachers can both *narrow* and *broaden* per section.
- Section LO pool is recomputed from `section.topic_pool` (so a section limited to 2 topics only offers those topics' LOs), unioned with global `selectedLos` and any custom LOs already on the section.
- "+ Add custom AO / LO" inputs let teachers append bespoke strings just for this section.

### 2. New props on SectionCard
Pass the candidate universes down so the card can render full lists, not just inherited:

```ts
type SectionCardProps = {
  // ...existing
  allAOs: AssessmentObjective[];        // = docAOs
  allKOs: readonly string[];            // = KNOWLEDGE_OUTCOMES (filtered by availableKos)
  globalAoCodes: string[];              // = selectedAoCodes (for "inherited" hint dot)
  globalKos: string[];
  globalLos: string[];
};
```

The existing call site at line 957-969 passes the new four/five props. Inside the card, an inherited item gets a small "(global)" muted label so teachers can tell which picks came from Step 3 vs. were added section-only.

### 3. Seeding stays the same, but is now just a default
`addSection` and the auto-seed effect (lines ~321-373) keep pre-filling new sections with the global picks — that becomes the *initial* state, which the teacher can then freely edit per section.

### 4. Generator already supports it
`supabase/functions/generate-assessment/index.ts` already reads `section.ao_codes`, `section.knowledge_outcomes`, `section.learning_outcomes` per section in its OBJECTIVES TO COVER block. No change required — once the UI writes section-specific arrays, the generator will already prompt the model to cover *that section's* objectives only.

### 5. Step 3 copy tweak
Update Step 3's intro line to read: *"Pick the AOs, KOs and LOs the **whole paper** must hit. You can refine each section's coverage in Step 4."* so teachers know section-level overrides are coming.

## Files touched

```
src/routes/new.tsx    SectionCard: replace read-only chip panel with full
                      per-section AO/KO/LO checklists + custom inputs;
                      pass docAOs / availableKos / global picks as new props;
                      tweak Step 3 helper copy
```

No DB migration, no edge function changes, no schema changes — `Section` already carries the three arrays.

## Result
- Each section card has its own AO / KO / LO picker, pre-seeded from the global picks but fully editable.
- Sections can intentionally diverge: Section A on AO1, Section B on AO2+AO3, Section C with a different LO subset, etc.
- Generator and (future) coverage meters automatically reflect the per-section choices because they already read off `section.ao_codes` / `knowledge_outcomes` / `learning_outcomes`.
