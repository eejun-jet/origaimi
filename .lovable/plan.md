

## Goal
Stop the MCQ paper from showing the same scientific diagram for every question. Each diagram must be specific to that question's stem, or omitted when not relevant.

## Root causes

1. **Stem never reaches the diagram cascade.** In `index.ts` line 855, `fetchDiagram({...})` is called without `stem: q.stem`. So past-paper matching, web search, and AI generation all see only `topic` + `learning_outcomes` — which are identical across every MCQ in a section. Result: the same top-ranked specimen figure wins for every question.
2. **No per-assessment de-duplication.** Even close matches pick the same image because we never track what's already been used.
3. **MCQs shouldn't trigger diagrams by default.** MCQ stems usually contain their own description ("Which circuit shows…"); only fire the cascade when the *stem itself* references something visual, not just because the topic does.
4. **AI prompt needs the stem to actually differ per question.** Without it, the AI generator returns a near-identical figure each time it's asked about the same topic.

## What we'll fix

### A. Pass the stem through everywhere
- **`index.ts`**: include `stem: q.stem` in the `fetchDiagram` call.
- **`diagrams.ts → fromWeb / fromTavilyImages / fromFirecrawl`**: accept `stem` and append a short stem snippet (first ~120 chars) to the search query so each question gets a different result set.
- **`fromAI`** already accepts stem — just confirm it's wired through.

### B. De-duplicate within an assessment
- **`fetchDiagram`**: accept an optional `usedUrls: Set<string>` and skip any candidate whose URL is already in it.
- **`index.ts`**: maintain a `usedDiagramUrls` set across the section/paper loop and pass it in. If the top-ranked past-paper match is already used, fall through to web → AI.

### C. Tighten the MCQ trigger
- **`questionWantsDiagram`**: switch the science-MCQ rule so it fires only when the **stem** contains a visual keyword ("circuit shown", "diagram below", "figure", "apparatus shown", "graph", etc.), not just because the topic blob does. Add a new `stem` parameter.
- For `structured` / `practical` / `comprehension` keep the current default-on behaviour.
- **`index.ts`**: pass `q.stem` into `questionWantsDiagram` as well.

### D. Stem-aware ranking in `fromPastPapers`
- Already builds tags from the stem snippet (line 139), but it weights stem and topic equally. Boost the score for caption/tag matches that come from **stem-only** keywords by +1, so different stems on the same topic prefer different figures.

## Files to edit

```
supabase/functions/generate-assessment/index.ts        ← pass stem to both
                                                          fetchDiagram() and
                                                          questionWantsDiagram();
                                                          maintain usedDiagramUrls set
supabase/functions/generate-assessment/diagrams.ts     ← stem param on fromWeb /
                                                          questionWantsDiagram;
                                                          usedUrls de-dup;
                                                          stem-keyword score boost
```

No DB migration. No UI change.

## Result
- Every science question that *does* get a diagram gets one matched to its own stem.
- MCQ paper stops force-attaching a diagram unless the stem actually references one — so most MCQs cleanly show no figure (matching MOE specimen behaviour for paper 1 MCQ).
- When two questions in the same paper would have picked the same figure, the second one falls through to web/AI and gets a different one.

