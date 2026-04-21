
# Wire the wizard to your real syllabuses

Right now the assessment wizard reads from a hardcoded topic map. Once you've parsed even one syllabus (like 2261), those rich, code-tagged topics sit unused. This change makes the wizard **syllabus-first** — teachers pick a real uploaded syllabus, then a paper, then topics flow in automatically with their MOE codes intact.

## The new wizard flow

**Step 1 — Pick your syllabus paper** (replaces "Subject + Level" dropdowns)

A grouped picker showing every parsed syllabus in your library:
```text
2261 Combined Humanities (2026)
  ├─ Paper 1 · 2261/01 · Social Studies (50m, 1h45)
  └─ Paper 2 · 2261/02 · History (50m, 1h50)

6091 Physics (2025)
  └─ Paper 1 · 6091/01 (40m, 1h15)
```
Selecting a paper auto-fills subject, level, and prefills duration + total marks from the syllabus metadata. Teacher can override.

**Step 2 — Assessment type & basics**
Title, assessment type (Topical / Mid-year / Prelim / Weighted Assessment / Alternative Assessment), duration, total marks. New types added to match what you mentioned:
- `weighted_assessment` — WA1, WA2, WA3
- `alternative_assessment` — performance task, project, oral, practical
- `end_of_year` — EYE
- (existing) Formative, Topical, Mid-year, Prelim, Mock

**Step 3 — Topics from the syllabus**
Shows the actual parsed topic tree for the selected paper, with codes as muted prefixes:
```text
☐ 1.1 · Living in a Diverse Society
☐ 1.2 · Working for the Good of Society
☐ 2.1 · Bonding Singapore
```
Hierarchy preserved — parent topics expand to show sub-strands. Multi-select.

**Step 4 — TOS (Table of Specifications)**
Auto-generated from selected topics, same as today. Each row now also stores `topic_code` so it flows through to questions and exports.

**Step 5 — Question types & sources** — unchanged.

**Step 6 — References & instructions** — unchanged.

**Step 7 — Generate** — unchanged, but the AI prompt now receives the syllabus code, paper code, and learning outcome codes per topic for tighter grounding.

## Schema additions

`assessments` table gets three nullable columns (additive, no breakage):
```text
+ syllabus_doc_id   uuid  -- which syllabus document
+ syllabus_paper_id uuid  -- which paper within it
+ syllabus_code     text  -- denormalised for fast display ("2261/02")
```
Existing draft assessments without these stay valid — the wizard just treats them as legacy.

`assessments.blueprint` JSON gains an optional `topic_code` field per row. Old rows without it still render.

## Fallback behaviour

If the user has **zero parsed syllabuses**, the wizard falls back to the current hardcoded `SUBJECTS / LEVELS / topicsFor()` flow with a banner: *"Upload a syllabus to unlock code-tagged topics."* This keeps the app usable while your library grows.

## What this unlocks immediately

- **Real MOE alignment** — topics, codes, and learning outcomes from the actual document
- **Multi-paper aware** — pick Paper 2 of 2261 and only get History topics, not Social Studies
- **Better AI generation** — prompt includes `Aligned to MOE 2261/02 §1.2` so questions cite the right reference
- **Coach-ready** — TOS Alignment Meter can later compare generated questions against the exact learning outcomes from the syllabus

## Out of scope this round

- Cross-paper assessments (e.g. a mock that pulls from both Paper 1 and Paper 2 of the same syllabus) — currently one paper per assessment
- Auto-suggesting marks distribution based on the syllabus's own weighting table — manual for now, easy follow-up
- Past-paper question pulling from the bank filtered by syllabus code — separate feature

## Technical notes

- New file `src/lib/syllabus-data.ts` with helpers: `loadSyllabusLibrary()`, `loadPaperTopics(paperId)` — both query Supabase directly from the client (RLS already open in trial mode).
- `src/routes/new.tsx` — Step 1 becomes the syllabus picker; `availableTopics` derived from `loadPaperTopics` instead of `topicsFor()`. Hardcoded fallback kept.
- `src/lib/syllabus.ts` — keep as fallback, add new `EXTENDED_ASSESSMENT_TYPES` with WA / Alternative / EYE.
- `supabase/functions/generate-assessment/index.ts` — accept new optional fields (`syllabusCode`, `paperCode`, blueprint rows with `topic_code`, `learning_outcomes`); inject them into the prompt as grounding context.
- Migration: add three nullable columns to `assessments`.
