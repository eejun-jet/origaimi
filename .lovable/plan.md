

# Add P6 Foundation level + upload PSLE syllabuses

PSLE has two parallel tracks at P6: Standard (codes 0001/0001/0009) and Foundation (codes 0031/0038/0039). To keep them distinguishable in the wizard picker, add a `P6 Foundation` level tag — same pattern as `Sec 4` vs `Sec 4N`.

## Change

Extend `LEVELS` in `src/lib/syllabus.ts`:

```text
"P1", "P2", "P3", "P4", "P5", "P6",
"P6 Foundation",                       ← new
"Sec 1", "Sec 2",
"Sec 3", "Sec 4",
"Sec 3N", "Sec 4N", "Sec 5N",
"JC1", "JC2",
```

## Upload guidance (after change lands)

Upload through `/admin/syllabus`:

| File | Title | Code | Subject | Level |
|---|---|---|---|---|
| PSLE_EL_0001 | PSLE English | 0001 | English Language | P6 |
| PSLE_Math_0001 | PSLE Mathematics | 0001 | Mathematics | P6 |
| PSLE_Sci_0009 | PSLE Science | 0009 | Science | P6 |
| Foundation_EL_0031 | PSLE Foundation English | 0031 | English Language | P6 Foundation |
| Foundation_Math_0038 | PSLE Foundation Mathematics | 0038 | Mathematics | P6 Foundation |
| Foundation_Sci_0039 | PSLE Foundation Science | 0039 | Science | P6 Foundation |

The duplicate `0001` code on English and Math is expected — SEAB scopes codes within a level group, and our schema has no uniqueness constraint on `syllabus_code`, so both upload cleanly and display as separate documents.

## What this exercises

- **PSLE English (0001)** likely has Paper 1 (Writing), Paper 2 (Language Use & Comprehension), Paper 3 (Listening), Paper 4 (Oral) — should produce 4 papers tagged with `assessment_mode` of `written`/`written`/`listening`/`oral`. Good real-world test of the mode-aware question-type defaults built earlier.
- **PSLE Science (0009)** is a single paper combining MCQ + open-ended — single-paper, no sections.
- **Foundation papers** are structurally simpler than Standard — fewer sub-papers, mostly written.

## Out of scope

- Auto-detecting Foundation vs Standard from the filename — admin tags it at upload time.
- Mother Tongue PSLE syllabuses (Chinese/Malay/Tamil + their Foundation variants) — flag for a follow-up upload batch.
- Filtering the wizard picker by level — defer until you have ~20+ syllabuses.

## Files touched

- `src/lib/syllabus.ts` — add `"P6 Foundation"` to `LEVELS` (1-line edit)

