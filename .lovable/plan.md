## Three fixes for Combined Science assessments

### 1. Combined Science generated all three sciences when only Physics + Chem were picked

**Root cause**: When a section has its own `learning_outcomes` selected (e.g. only Physics + Chemistry LOs picked in the builder), the generator's discipline balancer still operates on the full `topic_pool`, which on Combined Science papers contains all three disciplines (Physics, Chemistry, Biology). The pool is never trimmed to the LOs the teacher actually selected.

**Fix** (`supabase/functions/generate-assessment/index.ts`, `buildBalancedPlan` and the section preprocessing):
- Before building the balanced plan, when `section.learning_outcomes` is non-empty, filter `topic_pool` to keep only topics that contribute at least one of those selected LOs.
- Then build discipline groups (Physics / Chemistry / Biology / Practical) from this filtered pool, so disciplines the teacher excluded simply have no track and are never generated.
- Also persist `assessments.scoped_disciplines` from the new-assessment builder when LOs/topics are restricted to a subset of the syllabus disciplines, so coverage and the Coach respect that scope without requiring a manual override on the assessment page.

### 2. Downloaded `.docx` exam paper fails to open

**Root cause**: Question stems contain raw control characters (e.g. `0x17 ETB` shown in the topic field, and similar in stems coming from parsed syllabus text). Word's strict OOXML validation rejects files with bare C0 control characters in `<w:t>` runs and reports the file as corrupt.

**Fix** (`src/lib/export-docx.ts`):
- Add a `sanitizeForDocx(s)` helper that strips/replaces all C0 control bytes (`\x00–\x08`, `\x0B`, `\x0C`, `\x0E–\x1F`) and lone surrogate halves, normalises `\r\n` → `\n`, and trims trailing whitespace.
- Apply it to every string fed into a `TextRun` (stem, options, answer, mark scheme, topic, instructions, title, subject, level, section name).
- Apply the same sanitizer in `src/lib/export-tos-docx.ts` and `src/lib/export-tos-xlsx.ts` so TOS exports cannot regress with the same issue.

### 3. TOS "KO → LO" table is empty for Combined Science

**Root cause**: `buildKoLoGrouping` groups LOs by `outcome_categories` (KO names). For Combined Science the syllabus topics carry no `outcome_categories` (verified: 103 / 103 rows are `{}`), so the resulting table has zero rows even though every LO has a clear strand.

**Fix** (`src/lib/export-tos-xlsx.ts` + `src/lib/export-tos-docx.ts`):
- Extend `TosTopicIndexEntry` with `strand` and `sub_strand`.
- In `buildKoLoGrouping`, when `outcome_categories` is empty, fall back to `strand` (e.g. "Kinematics", "Acids, Bases and Salts") as the KO name. This is what teachers actually want to see for sciences.
- Always render a per-discipline column. For Combined Science the table will have one column for each science actually in scope (Physics / Chemistry / Biology), each cell listing that strand's LOs prefixed with `✓` (covered by ≥1 question) or `·` (not covered), plus a "Covered LOs / Total LOs" count next to the Δ column so teachers see how many LOs within each KO were tested at a glance.
- Update `tosTopicIndex()` in `src/routes/assessment.$id.tsx` to pass `strand` and `sub_strand` through from `topic_pool`.
- Mirror the same row builder in `export-tos-docx.ts` so the .docx TOS shows the same condensed table.

### Files touched
- `supabase/functions/generate-assessment/index.ts`
- `src/routes/new.tsx` (persist `scoped_disciplines` on insert)
- `src/lib/export-docx.ts`
- `src/lib/export-tos-xlsx.ts`
- `src/lib/export-tos-docx.ts`
- `src/routes/assessment.$id.tsx` (extend `tosTopicIndex` payload)

After approval I will implement and redeploy the edge function.