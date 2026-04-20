
# Syllabus ingestion — with code preservation

Adding **syllabus code retention** to the ingestion pipeline so codes like `0001`, `2260/01`, `6091`, `1184/02` follow each topic through the whole app.

## What changes vs the previous plan

Same flow (upload → parse → review → publish), with codes treated as first-class data — never re-derived, never inferred by AI on the fly.

## Where codes live

**At three levels**, because MOE uses them at all three:

1. **Document level** — the syllabus paper itself (e.g. `2260/01` = Sec Geography Paper 1, `0001` = General Paper)
2. **Subject/syllabus level** — the overarching subject code (e.g. `6091` = Pure Physics O-Level)
3. **Topic / learning outcome level** — sub-codes MOE assigns inside the syllabus (e.g. `1.2.3`, `LO-MA-P5-NUM-3`)

## Schema additions

```text
syllabus_documents
  + syllabus_code        text   -- e.g. "2260/01", "6091"
  + paper_code           text   -- e.g. "01", "02" (nullable)
  + exam_board           text   -- "MOE" | "SEAB" | "Cambridge"
  + syllabus_year        int    -- e.g. 2021

syllabus_topics
  + topic_code           text   -- e.g. "1.2.3" or "MA.P5.NUM.3"
  + parent_code          text   -- for hierarchy (strand → sub-strand → topic)
  + learning_outcome_code text  -- e.g. "LO-1.2.3a" (nullable)
  + source_doc_id        uuid   -- FK to syllabus_documents (carries syllabus_code)
```

Codes are **stored as text exactly as printed** — preserves leading zeros (`0001`), slashes (`2260/01`), and dots (`1.2.3a`). No normalisation, no integer casting.

## Extraction prompt rules

The AI parser is instructed to:
- Pull the syllabus code from the document cover/header **first**, before topics
- For every topic, capture the printed reference number verbatim (don't generate one if absent)
- Mark `topic_code = null` rather than guess — teachers can fill in during review
- Preserve hierarchical codes intact (`1.2.3a` stays `1.2.3a`, not split)

## Where codes show up in the app

- **Topic picker (Step 2 of wizard)** — code shown as a muted prefix: `2260/01 · 1.2 · Plate Tectonics`
- **Blueprint table** — code column alongside topic name
- **Generated assessment header** — auto-fills "Based on syllabus 2260/01 (2021)"
- **Each question** — stores `syllabus_code` + `topic_code` so exports can cite the source
- **Mark scheme PDF** — footer reference: `Aligned to MOE 6091 §1.2.3`
- **Question Bank filter** — search/filter by syllabus code

## Review UI additions

The admin review screen gets two extra fields per row:
- Editable `topic_code` input (auto-filled from extraction, manually correctable)
- Document-level code shown as a sticky header so reviewer never loses context

## Out of scope

- Auto-mapping codes between syllabus revisions (e.g. 2013 `2236` → 2021 `2260`) — manual link if needed
- Cross-board code reconciliation (Cambridge vs SEAB numbering) — kept separate per `exam_board`

---

**This plan extends the previous syllabus-ingestion plan, not replaces it.** When you're ready to upload the PDFs, I'll build the upload page + parser + review UI in one pass, with code retention wired through from day one.
