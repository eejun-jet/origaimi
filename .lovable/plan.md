
# Multi-paper syllabus support

The 2261 PDF proves a single syllabus document can contain multiple papers (Paper 1 Social Studies + Paper 2 History) under one umbrella code. The current schema and parser collapse them into one bag. Fix that before bulk upload.

## Schema changes

**New table `syllabus_papers`** sits between `syllabus_documents` and `syllabus_topics`:

```text
syllabus_papers
  id                uuid pk
  source_doc_id     uuid → syllabus_documents
  paper_number      text   -- "1", "2" (verbatim from doc)
  paper_code        text   -- "2261/01" (composed: syllabus_code + "/" + zero-padded paper_number)
  component_name    text   -- "Social Studies", "History"
  marks             int    -- 50
  weighting_percent int    -- 50
  duration_minutes  int    -- 105 (parsed from "1 hr 45 min")
  topic_theme       text   -- "The Making of the 20th Century Modern World, 1910s–1991" (nullable)
  position          int
```

**`syllabus_topics` gets a new column**:
```text
+ paper_id  uuid → syllabus_papers  (nullable — for single-paper syllabuses)
```
`source_doc_id` stays for traceability. `paper_id` is what the wizard filters on.

## Parser changes (`parse-syllabus` edge function)

The AI tool schema gains a `papers` array. The system prompt is updated to:

1. Detect multi-paper structure by scanning for an examination-format table on the cover/intro (e.g. "Paper No. | Component | Marks | Weighting | Duration").
2. Emit one entry in `papers[]` per paper found. If the doc is single-paper, emit one entry with `paper_number: "1"`.
3. For each topic, emit `paper_number` so we can resolve it back to the right `syllabus_papers` row on insert.
4. Compose `paper_code` server-side: `${syllabus_code}/${paper_number.padStart(2, "0")}` — never let the AI invent it.

## UI changes

**Upload page (`/admin/syllabus`)** — no change. User still uploads one file.

**Review page (`/admin/syllabus/$id`)** — gains a paper switcher at the top:
```
[ Paper 1 · 2261/01 · Social Studies (50m, 1h45) ]  [ Paper 2 · 2261/02 · History (50m, 1h50) ]
```
Clicking a tab filters the topic list to that paper's topics. Editable fields per paper (component name, marks, duration) so the user can correct misparses.

**Down the line** (separate task — flagging not building): the wizard's subject/level picker becomes a syllabus + paper picker. "Combined Humanities 2261 → Paper 2 (History)".

## Out of scope this round

- Auto-detecting alternative-paper structures (e.g. core vs extended for IGCSE) — current MOE syllabuses don't use this pattern
- Cross-paper topic linking (some Math syllabuses share content across Paper 1 and Paper 2) — handle case-by-case if it comes up
- Bulk upload — still one file at a time

## Migration impact

- New table + new column = additive, no data loss
- Existing parsed docs (none yet beyond test data) can be re-run through the parser to backfill `paper_id`
- Topics with `paper_id = null` still work — wizard treats them as "applies to whole syllabus"
