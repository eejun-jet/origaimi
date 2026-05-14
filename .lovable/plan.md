## Plan

1. **Repair the analysis blueprint for past-paper imports**
   - Update `src/lib/analyse-past-paper.ts` so analysed papers no longer create assessments with an empty `blueprint.sections` array.
   - When the source paper is linked to a syllabus, build a single analysis section containing the matching syllabus topic pool, including `strand`, `sub_strand`, `learning_outcome_code`, KO categories, AOs, and LOs.
   - Set `num_questions` and marks from the parsed paper so existing question-to-section coverage logic can map each question to that syllabus pool.

2. **Make the Coverage Explorer robust for existing broken analyses**
   - In `src/routes/assessment.$id.tsx`, add a fallback topic-pool builder for `past_paper_analysis` assessments whose blueprint has no sections but does have `syllabus_doc_id` and tagged questions.
   - This prevents the KO tiling view and map view from becoming empty just because the stored blueprint is legacy/empty.

3. **Preserve current UI behaviour**
   - Keep the existing “Expand”, “By KO”, “By topic”, and “Map” interactions.
   - Only change the data source that feeds KO/LO grouping; no visual redesign.

4. **Verify against the reported paper**
   - Confirm the stored `2024 Comb Sci P1 (Phy Chem)` analysis has LO tags present.
   - After code changes, verify the Coverage Explorer can derive KO groups from the linked Combined Science syllabus instead of relying on an empty blueprint.