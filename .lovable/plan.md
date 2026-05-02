## Correction

You’re right. The spreadsheet already contains the hierarchy:

```text
LO Code | KO (Knowledge Outcome) - topic | Content | Learning Outcome (LO)
1.1.1   | Experimental Chemistry         | Experimental Design | name appropriate apparatus...
1.1.2   | Experimental Chemistry         | Experimental Design | suggest suitable apparatus...
2.2.1   | Particulate Nature             | Atomic Structure    | state the relative charges...
```

So the Coverage view should not infer KO→LO from question tags, and it should not use the generic science skill buckets (`Knowledge`, `Understanding`, `Application`, `Skills`) as the KO containers for LO coverage.

The correct structure is:

```text
KO / Topic container
  Content sub-container
    LO code — LO statement — covered / not covered
```

Questions should only determine whether a coded LO is covered. They should not decide which KO the LO belongs to.

## Plan

### 1. Preserve LO codes in the assessment blueprint

Currently the app’s `SectionTopic` shape only stores LO text:

```ts
learning_outcomes?: string[]
outcome_categories?: string[]
```

That loses the unique LO code when building coverage.

I will extend the client-side blueprint topic shape to carry coded LO metadata alongside the current text array, for example:

```ts
learning_outcome_items?: Array<{
  code: string
  text: string
  ko: string
  content: string
}>
```

This keeps backward compatibility: older assessments still use `learning_outcomes`, while newly loaded syllabus data can retain the coded mapping.

### 2. Load the coded mapping from the syllabus dataset

The uploaded dataset structure maps:

- `LO Code` → unique LO identifier
- `KO (Knowledge Outcome) - topic` → parent KO/topic container
- `Content` → sub-topic/content group
- `Learning Outcome (LO)` → LO statement

I will update the syllabus topic mapping flow so these coded rows are carried into the assessment builder and saved inside `assessment.blueprint` when teachers select LOs.

For existing database rows, the best available mapping is already in `syllabus_topics`:

- `topic_code` / `learning_outcome_code`
- `title`
- `strand` / `sub_strand`
- `learning_outcomes`

I will use those fields to reconstruct the hierarchy as:

```text
KO = strand, or title fallback
Content = sub_strand, or title fallback
LO code = learning_outcome_code, or topic_code fallback
LO text = learning_outcomes item
```

### 3. Rework the Coverage panel hierarchy

In `src/routes/assessment.$id.tsx`, replace the current `koLoGroups` logic.

Current incorrect behaviour:

```text
For each question:
  take q.knowledge_outcomes
  take q.learning_outcomes
  put every LO under every KO found on the same question
```

New behaviour:

```text
For each selected syllabus LO item in the blueprint:
  place LO under its stored KO/topic and content group
  look up whether that LO is covered by question tags
```

The UI will become:

```text
Experimental Chemistry              2 / 6 LOs covered
  Experimental Design
    ✓ 1.1.1 name appropriate apparatus...
    ○ 1.1.2 suggest suitable apparatus...
  Methods of Purification and Analysis
    ✓ 1.2.1 describe methods of separation...
    ○ 1.2.2 suggest suitable separation...

Particulate Nature                  1 / 7 LOs covered
  Kinetic Particle Theory
    ✓ 2.1.1 describe solid, liquid and gaseous states...
  Atomic Structure
    ○ 2.2.1 state relative charges...
```

### 4. Stop presenting KO and LO coverage as separate concepts

I will remove or merge the separate flat `KO Coverage` card from the sidebar.

Instead, the sidebar will show one card:

**Knowledge / Learning Outcome Coverage**

Description:

> Learning Outcomes are grouped under their parent syllabus KO/topic. Coverage is counted at LO level.

Each KO/topic header will show:

- number of covered coded LOs
- total coded LOs selected for the assessment
- marks tagged to that KO/topic where available

The individual LO rows will show:

- LO code
- LO statement
- covered / uncovered status
- question count evidence
- existing comment/remark pill support

### 5. Update the full Coverage Explorer

The expanded Coverage Explorer will use the same hierarchy:

```text
KO/topic overview tile → content groups → coded LOs
```

No more `Unassigned` bucket unless the LO truly lacks a stored KO/code mapping. If that happens, it will be labelled clearly as a data issue:

```text
Unmapped LO metadata
```

not as a normal KO.

### 6. Update per-section breakdown

The per-section breakdown will also stop listing KOs and LOs separately. It will render the same nested structure for that section:

```text
Section A
  Experimental Chemistry
    Experimental Design
      1.1.1 ...
```

### 7. Keep AI tagging separate from hierarchy

The retagging function can still decide which LO statements a generated question covers, but it should only return LO identifiers/statements from the allowed list. The hierarchy itself comes from the stored syllabus dataset, not from AI.

If needed, I will adjust the retag prompt/output display later so evidence can match by LO code first, then text fallback.

## Files to change

- `src/lib/sections.ts`
  - add optional coded LO metadata to `SectionTopic`
  - preserve it during legacy/sectioned blueprint handling

- `src/lib/syllabus-data.ts`
  - expose LO code / KO / content fields from existing syllabus rows where available

- `src/routes/new.tsx`
  - carry coded LO metadata into selected blueprint sections

- `src/routes/assessment.$id.tsx`
  - rebuild coverage hierarchy from coded LO metadata
  - merge KO/LO coverage into one nested view
  - update Coverage Explorer and per-section breakdown

Optional, only if the current database rows do not yet contain the uploaded coded mapping:

- add/import the Chemistry dataset rows into the syllabus tables so each LO code is preserved in `learning_outcome_code` / `topic_code` and each row’s KO/content fields are available.

## Expected result

Coverage will read the way your syllabus is structured:

```text
KO/topic → Content → LO code → LO statement
```

not:

```text
KO tags and LO tags as separate unrelated coverage lists
```

The AI can affect whether an LO is marked covered, but it cannot re-parent, duplicate, or invent the KO/LO hierarchy.