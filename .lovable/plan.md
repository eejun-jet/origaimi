

## Goal
Make AI-generated **Science** papers (Physics / Chemistry / Biology / General Science) include MOE-style diagrams the way the uploaded specimen papers (e.g. 5086) do — circuits, apparatus, ray paths, biological structures, graphs, etc. — instead of producing mostly text-only questions.

## What's broken today
1. **Specimen diagrams are never cropped.** `parse-paper` records each figure as a row in `past_paper_diagrams`, but `image_path` is set to the whole PDF (`papers/<file_path>`). When the generator tries to reuse a specimen figure, it gets a PDF link, not an image — so the past-paper tier always fails for the UI.
2. **Diagram trigger is too narrow.** `questionWantsDiagram` requires both a question type in `{structured, source_based, practical, comprehension}` AND a visual keyword. Many science MCQ / structured questions skip diagrams even when a circuit or apparatus would be standard.
3. **AI generation is gated behind two failed tiers.** With (1) broken and the web tier hit-or-miss, science questions often end up with no diagram at all rather than a clean AI-generated MOE-style figure.
4. **No diagram-density target per paper.** A specimen paper like 5086 has roughly 1 figure every 2–3 questions; we currently attempt 0–1 per section by accident.

## What we'll build

### A. Crop specimen-paper figures during upload
Extend `parse-paper` so each detected figure is rendered as a real image and stored in the public `diagrams` bucket.

- Use Lovable AI (`google/gemini-3-pro-image-preview`) in **vision-extract mode**: feed it the PDF page, ask it to return the cropped figure(s) as base64 PNGs along with caption + topic tags.
- For each figure: upload to `diagrams/specimen/<paper_id>/<uuid>.png`, store that key in `past_paper_diagrams.image_path` (no `papers/` prefix), keep `caption`, `topic_tags`, `page_number`, and add `bbox` if available.
- Re-parse-friendly: keep the existing `delete + insert` so re-uploading works.

### B. Strengthen the past-paper match in the diagram cascade
In `diagrams.ts → fromPastPapers`:
- Match on **subject + level**, but also fall back to subject-only when level has no hits.
- Score by topic-tag overlap **and** caption keyword overlap (e.g. "circuit", "lens", "Bunsen", "alkene").
- Prefer specimen / sample papers (check `past_papers.title` for "specimen" / "sample") with a +5 score boost — these are the highest-quality figures.
- Resolve URLs from the public `diagrams` bucket directly (already supported).

### C. Make the diagram trigger science-aware
In `questionWantsDiagram`:
- For Physics / Chemistry / Biology / General Science, default to **wanting a diagram** for `structured`, `practical`, and `comprehension` types unless the topic is purely descriptive (e.g. "definitions", "history of").
- Keep the visual-keyword path for MCQ and short-answer.
- Add per-section soft target: aim for ~40 % of science questions to carry a figure (skip extras gracefully when the cascade returns null).

### D. Tighten the AI fallback for science
In `fromAI`:
- Pass `subject + level + topic + first learning outcome + question stem snippet` into the prompt so the figure is question-specific (currently it only uses topic + first LO).
- Keep MOE-style constraints (B&W line art, sans-serif labels, no captions inside the image).
- Prepend "Singapore MOE {Level} {Subject}" to anchor visual conventions.

### E. UI: nothing structural, just confirm
Diagrams already render in `assessment.$id.tsx` with caption + citation. No change needed beyond verifying the new specimen-cropped images display correctly.

## Files to edit

```
supabase/functions/parse-paper/index.ts          ← crop figures, store as PNGs
supabase/functions/generate-assessment/diagrams.ts ← stronger past-paper match,
                                                     science-friendly trigger,
                                                     better AI prompt
supabase/functions/generate-assessment/index.ts  ← (minor) pass stem to fetchDiagram
```

No DB migration needed — existing `past_paper_diagrams` columns already cover everything.

## Out of scope
- Vector / SVG diagrams (Worker runtime can't run native SVG renderers reliably).
- Editing/regenerating individual diagrams from the review UI (already exists via `generate-diagram` function — unchanged).
- Cropping diagrams from non-specimen papers automatically (we'll still index them, but the AI cropper runs on every parse since cost is small).

## Result
After re-uploading a specimen like 5086, its figures land in the `diagrams` bucket as cropped PNGs. New Physics / Chemistry / Biology papers generated for the same level will:
- Reuse those specimen figures when topic tags overlap (best case — citation reads "MOE 2023 5086 Paper 2").
- Fall back to web-sourced diagrams from allow-listed science sites.
- Otherwise generate a clean MOE-style B&W figure with Nano Banana Pro keyed off the question stem.

