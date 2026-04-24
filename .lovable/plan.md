## Goal

Replace the placeholder Social-Studies content currently sitting on the History syllabi (`2126` N(A) Combined Humanities (History) and `2261` Sec 4 Combined Humanities (History)) with the **canonical AO/Objective + LO/KO/Section dataset** you uploaded. After this, generating a History paper will tag every question with the correct AO (with command-word descriptors), the right LO, the correct KO content block, and the correct Section (A/B).

## What I read from your spreadsheet

**Sheet 1 — Assessment Objectives (3 AOs, with sub-objective command words)**
- **AO1 — Deploy Knowledge**: select, organise and use relevant historical knowledge in context.
- **AO2 — Construct Explanation & Communicate Historical Knowledge**: analyse/explain using causation, consequence, change, continuity, significance. Command: *Explain… / How far do you agree…*
- **AO3 — Interpret and Evaluate Source Materials**, with **7 sub-descriptors**:
  1. Comprehend & extract relevant information
  2. Draw inferences — *infer, message, what does it tell you*
  3. Compare & contrast — *compare, how similar/different, how far similar/different*
  4. Distinguish fact / opinion / judgement — *how reliable, how far can we trust, how accurate, how far can one source prove another wrong, are you surprised*
  5. Recognise values & detect bias — *purpose, why was this source created, would X have agreed, are you surprised*
  6. Establish utility — *how useful, how far can one source prove another wrong*
  7. Draw conclusions from evidence — *given a hypothesis, how far do the sources support…*

**Sheet 2 — LO ↔ KO ↔ Section mapping (6 LO bands)**
1. Post-war peace settlements (Treaty of Versailles, redrawing of boundaries) — Section **B**
2. Collective security in the 1920s (League of Nations) — Section **B**
3. Authoritarian regimes — **Nazi Germany** case study (Sections **A, B**) and **Militarist Japan 1920s–30s** (Section **B**)
4. Outbreak & end of WWII in Europe (Sections **A, B**) and Asia–Pacific (Section **B**); reasons for end of WWII (Section **B**)
5. The Cold War — Origins in Europe (A, B), Korean War 1950–53 case study (A, B), Vietnam War 1954–75 case study (B)
6. End of the Cold War / decline of the USSR — Section **B**

`*` items in your sheet are flagged as the **examined case studies**; the bullet text under each is the verbatim KO content block to seed.

## Implementation plan

### 1. Data migration — re-seed the two History syllabus docs

Apply to **both** `syllabus_documents.id` values:
- `51ed087a-c0bc-4c94-ac32-e676095b9796` — Sec 4 Combined Humanities (History) 2261
- `e648a761-8542-4809-a008-cbc246fb4d0b` — Sec 4N(A) Combined Humanities (History) 2126

Steps inside one SQL migration (data-only, idempotent):

a. **Wipe stale objectives & topics** for those two doc IDs (they currently hold Social-Studies/citizenship content and a duplicated AO/Objective set).

b. **Re-seed `syllabus_assessment_objectives`** with exactly **3 rows per doc** (AO1, AO2, AO3), each carrying:
   - `code` = `AO1` / `AO2` / `AO3`
   - `title` = "Deploy Knowledge" / "Construct Explanation and Communicate Historical Knowledge" / "Interpret and Evaluate Source Materials"
   - `description` = full objective text from the sheet
   - For AO3, append the 7 sub-descriptors with their command words inside `description` (one bullet each) so the generator surfaces them in the prompt.

c. **Re-seed `syllabus_topics`** with one row per LO/KO pairing from Sheet 2 (≈ 22 rows per doc). Each row carries:
   - `title` = the LO statement (e.g. *"Assess the impact of post-war peace settlements on Europe."*)
   - `learning_outcomes` = `[ <full LO text> ]` (verbatim, used by the generator's LO pool)
   - `outcome_categories` = the **KO content block** parsed into discrete bullets (e.g. *"Treaty of Versailles — War Guilt Clause, reparations, demilitarisation, territorial reductions"*). These become the **KO pool** the generator must collectively cover.
   - `ao_codes` = appropriate AOs for that band — Section A bands (SBQ source-based) get `AO3`; essay/structured bands get `AO1, AO2`; case-study bands tagged for both A and B get all three.
   - `section` = `A`, `B`, or `A, B` exactly as in the dataset
   - `topic_code` = `1`–`6` matching the LO band number from your sheet
   - `parent_code` = the KO heading (e.g. `War in Europe and the Asia-Pacific`, `The Cold War`, `End of the Cold War`) so reviewers can group rows in the admin UI
   - `position` = stable order following the spreadsheet
   - Skip the *Non-examinable* overview rows (LO band 1 row 1 "Overview of WWI" and LO band 3 row 1 "Overview of attempts at viable political systems") so the generator never picks them.
   - `paper_id` is left NULL (a single content pool spans the whole History paper — both 2126 and 2261 use a single "Paper 1" component, and the generator's `loadDocTopics` fallback already handles doc-level pools).

d. Mark `syllabus_documents.parse_status = 'parsed'` (already true) and bump `updated_at`.

### 2. (No code changes needed in the generator)

The current `generate-assessment` edge function already:
- Pulls `ao_codes`, `outcome_categories` (KO), and `learning_outcomes` from `syllabus_topics` into each section's pool (lines 251–303 of `index.ts`).
- Lists the AO codes, KO categories, and verbatim LO statements in the prompt (lines 493–509) and instructs the model to collectively cover them and per-question tag them.
- Stores `ao_codes`, `knowledge_outcomes`, `learning_outcomes` on each generated row, which feeds the **TOS Alignment Meter** you built last iteration.

So once the data is reseeded, the AO/KO/LO meter and the per-section breakdown will *immediately* reflect the History dataset — no app/edge changes required.

### 3. Optional polish (only if you want it now)

- Surface AO3's command-word descriptors in the editor sidebar (small "command words" chip under each AO3 question) so reviewers see *why* the model picked the AO3 sub-skill. This is a 1-file change in `assessment.$id.tsx` reading from a static map. **Tell me if you want this included.**

## Files touched

- **New**: `supabase/migrations/<ts>_seed_history_aos_los_kos.sql` — data migration (DELETE + INSERT) for both History docs.
- **No app code changes** — generator already consumes these fields correctly.

## Verification after apply

1. Open `/admin/syllabus/51ed087a-…` (Sec 4 History 2261). Confirm 3 AOs (AO1/AO2/AO3 with the History descriptors, AO3 lists 7 command-word bullets) and ~22 LO/KO topic rows tagged with sections A / B / A,B.
2. Repeat for the 2126 N(A) doc.
3. From `/new`, pick "Combined Humanities (History) 2261", add a Section A (source-based, AO3) and Section B (essay/structured, AO1+AO2), generate. Confirm questions are tagged with the correct AO/KO/LO and that the **TOS Alignment Meter** shows AO3 dominating Section A and AO1/AO2 dominating Section B.

**Approve to proceed and I'll write the migration.**