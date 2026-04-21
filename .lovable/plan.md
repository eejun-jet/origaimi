

# Multi-track syllabus support + smarter parsing

The 5 new syllabuses surface one real new challenge (multi-track papers in 5086) and a few smaller refinements. Plan covers both.

## 1. Multi-track papers (5086 Combined Science)

Combined Science 5086 has 5 paper components, but a candidate only sits 4 — which 4 depends on their subject combination (Phy/Chem, Phy/Bio, Chem/Bio).

**Schema additions** to `syllabus_papers`:
```text
+ section          text   -- "Physics" | "Chemistry" | "Biology" | null
+ track_tags       text[] -- ["physics", "chemistry"] for cross-section papers
+ is_optional      bool   -- false (most) | true (rare alternative papers)
```

`syllabus_topics` already has `paper_id`. Add:
```text
+ section          text   -- denormalised from paper for fast filtering
```

This lets us model:
```text
5086 Paper 1 (MCQ) → section: null, track_tags: ["physics","chemistry","biology"]
5086 Paper 2       → section: "Physics"
5086 Paper 3       → section: "Chemistry"
5086 Paper 4       → section: "Biology"
5086 Paper 5       → section: null, track_tags: ["physics","chemistry","biology"] (Practical)
```

**Wizard impact**: when a teacher picks a Combined Science paper, they additionally pick a *section* (Physics/Chemistry/Biology). Topics filter to that section. For single-section papers (Paper 2/3/4) the section is auto-locked.

## 2. Parser improvements

Update `parse-syllabus` system prompt to:

- Detect the **scheme of assessment table** more robustly — already works for 2261/4052/1184, needs to handle the multi-row 5086 layout where one paper draws from multiple sections.
- Recognise **section headings** like "Paper 1 Social Studies" / "Paper 2 Geography" / "PHYSICS SECTION" and tag downstream topics with `section`.
- For combined-subject syllabuses (2260, 2262, 2261), set `paper.component_name` from the section heading verbatim ("Social Studies", "Geography", "Literature in English").
- For oral/listening/practical papers (English P3/P4, Sci P5), set a new `paper.assessment_mode` field: `"written" | "oral" | "listening" | "practical"`. Stored as a column on `syllabus_papers`.

## 3. Wizard polish

- **Step 1 paper picker** gains a section sub-selector when the chosen paper has multiple `track_tags`. Default to first section.
- **Assessment mode badge** on the picker — "Oral", "Practical", "Listening" — so teachers know what they're building.
- For **oral/listening** papers, the question-types step pre-selects appropriate types (e.g. "Spoken Response", "Listening MCQ") and hides irrelevant ones (Essay, Structured).

New question types to add to `src/lib/syllabus.ts`:
```text
+ { id: "spoken_response", label: "Spoken response" }
+ { id: "listening_mcq",   label: "Listening MCQ" }
+ { id: "note_taking",     label: "Note-taking" }
+ { id: "summary",         label: "Summary writing" }
```

## 4. Out of scope (flagging only)

- **Shared components across syllabuses**: Paper 1 Social Studies is identical across 2260, 2261, 2262. Today we parse it 3 times. A future "shared component library" could dedupe this; not worth building yet — costs are low.
- **Subject-combo presets**: e.g. picking "Physics + Chemistry" once and having the wizard always restrict to those tracks. Defer until a teacher asks.

## 5. Migration impact

- Additive only. New columns: `syllabus_papers.section`, `syllabus_papers.track_tags`, `syllabus_papers.is_optional`, `syllabus_papers.assessment_mode`, `syllabus_topics.section`.
- Existing parsed docs (2261) have all `section = null`, all `track_tags = null` — they continue to work as today.
- New uploads (4052, 1184, 2260, 2262 are all simple) will mostly leave these new fields null too. Only 5086 exercises the multi-track logic.

## Files touched

- `supabase/migrations/...` — add 5 columns
- `supabase/functions/parse-syllabus/index.ts` — extended tool schema, updated system prompt, server-side paper_code composition already in place
- `src/integrations/supabase/types.ts` — auto-regenerates
- `src/lib/syllabus-data.ts` — surface `section`, `trackTags`, `assessmentMode` in the typed objects
- `src/routes/admin.syllabus.$id.tsx` — show section + mode badges in the paper-switcher tabs; section editor per topic
- `src/routes/new.tsx` — section sub-selector when multi-track; mode-aware question-type defaults
- `src/lib/syllabus.ts` — add 4 new question types

