## Goal

For History Section B (essay) questions, generate answers and mark schemes in a strict **two-factor SEAB-style essay format** with explicit L1–L4 level descriptors and a model essay answer that demonstrates the historical analysis required for each level.

## Current Behaviour

- `supabase/functions/generate-assessment/index.ts` has detailed L1–L4 mark schemes for source-based skills (lines 105–200) but **no equivalent block for `long` (essay) questions**.
- Humanities essays fall through to the generic prompt: the LLM produces a free-form `mark_scheme` and a short `answer`, with no enforced level descriptors and often no real model essay.
- Section B essays are detected by `subjectKind === "humanities" && question_type === "long"` (the `isHumanitiesNonEssay` check at line 1097–1100 already excludes them from source fetching).

## Plan

### 1. Add a History Essay Mark Scheme constant
In `index.ts`, beside the existing `SBQ_SKILLS` block, add a new `HISTORY_ESSAY_MARK_SCHEME` string with the exact level descriptors the user specified:

```
LEVEL DESCRIPTORS (use VERBATIM in the mark_scheme field, then add a short awarding note):
L1 (1–2 marks): Describes without focus on the question.
L2 (3–4 marks): Describes one or both factors with details, without explanation.
L3 (5–8 marks): Explains one or both factors with explanation.
   - Maximum of 6 marks if only ONE factor is explained.
   - 7–8 marks requires BOTH factors explained with detail.
L4 (9–10 marks): L3 + a clear, detailed evaluation reaching a substantiated overall judgement.
```

It will also include a one-paragraph guidance block explaining what counts as "describe" vs "explain" vs "evaluate" so the LLM applies the bands consistently.

### 2. Add a History Essay Answer Template
A second constant `HISTORY_ESSAY_ANSWER_TEMPLATE` instructing the model to write the `answer` field as a **full model essay** structured as:

- **Introduction** (1 short paragraph): defines key terms, identifies the two factors to be discussed, states a preliminary stand.
- **Factor 1 (PEEL paragraph)**: Point → Evidence (specific dates, names, statistics, events) → Explanation linking to the question → Mini-link.
- **Factor 2 (PEEL paragraph)**: same structure for the contrasting/second factor.
- **Evaluation paragraph**: weighs the two factors against each other (more important / decisive / necessary-vs-sufficient / short-vs-long-term), reaches a substantiated judgement.
- **Conclusion** (1–2 sentences): restates the judgement.

The template enforces inclusion of concrete historical detail (dates, named actors, events, figures) so the answer is usable as a student exemplar — not a generic outline.

### 3. Wire it into the prompt builder
In `buildSectionUserPrompt` (around line 679), detect History essay sections:
```ts
const isHistoryEssay =
  opts.subjectKind === "humanities" &&
  section.question_type === "long";
```
When true, append a new `historyEssayBlock` to the prompt containing:
- The level descriptor block (rendered verbatim).
- The model-answer template.
- A hard instruction: "The `mark_scheme` field MUST contain the four level descriptors verbatim, followed by 1–2 indicative-content bullets per level tailored to this specific question. The `answer` field MUST be a full model essay (~400–600 words) following the template above, with at least 4 specific historical references (dates, names, events, statistics) per factor."

This block is inserted between `humanitiesSourceGuidance` and `sbqSectionPreamble` (line 900) so it only applies to History essay sections and does not interfere with SBQ logic.

### 4. Strengthen the question stem guidance for essays
Add an instruction that the essay stem must be a two-factor "How far / To what extent / Which was more important" question phrased so that exactly two named factors can be discussed (the prompt will list the two factors explicitly to anchor L2/L3 marking).

### 5. No DB / frontend changes needed
The frontend (`src/routes/assessment.$id.tsx`) already renders `mark_scheme` and `answer` as preformatted text (`whitespace-pre-wrap`) so multi-paragraph essays and level descriptors will display correctly without UI work.

### 6. Redeploy the edge function
`generate-assessment` is redeployed automatically; no other functions change.

## Files to edit

- `supabase/functions/generate-assessment/index.ts`
  - Add `HISTORY_ESSAY_MARK_SCHEME` and `HISTORY_ESSAY_ANSWER_TEMPLATE` constants (near existing `SBQ_SKILLS`).
  - Inject `historyEssayBlock` into `buildSectionUserPrompt` when `subjectKind === "humanities"` and `question_type === "long"`.

No schema, no frontend changes.