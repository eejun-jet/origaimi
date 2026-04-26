# History Section B essay — SEAB-style L1–L4 mark scheme + model essay

## Status: implemented

## Changes

### `supabase/functions/generate-assessment/index.ts`
1. Added `HISTORY_ESSAY_MARK_SCHEME` constant — verbatim L1–L4 level descriptors:
   - L1 (1–2): describes without focus
   - L2 (3–4): describes one or both factors with details, no explanation
   - L3 (5–8): explains one or both factors; max 6 if only one factor
   - L4 (9–10): L3 + clear, detailed evaluation
   Plus level-awarding guidance on what counts as describe / explain / evaluate.

2. Added `HISTORY_ESSAY_ANSWER_TEMPLATE` constant — 5-part PEEL essay structure (Intro → Factor 1 → Factor 2 → Evaluation → Conclusion) with an at-least-4-historical-references-per-factor rule and a 400–600 word target. Designed as an L4 student exemplar.

3. Added `isHistoryEssay` detection in `buildSectionUserPrompt` (`subjectKind === "humanities" && question_type === "long"`).

4. Added `historyEssayBlock` injected into the section prompt only for History essay sections. It enforces:
   - Two-factor question stems opening with SEAB command words (How far, To what extent, Which was more important).
   - The two factors must be named explicitly in the stem.
   - `mark_scheme` must contain the four L1–L4 lines verbatim plus indicative-content bullets.
   - `answer` must be a fully written model essay following the template, not a bullet outline.

### No frontend / DB changes
`mark_scheme` and `answer` are already rendered as `whitespace-pre-wrap` text in `src/routes/assessment.$id.tsx`, so multi-paragraph essays and level descriptors display correctly without UI work.

### Deployment
`generate-assessment` redeployed.
