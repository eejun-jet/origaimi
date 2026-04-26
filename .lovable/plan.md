# SBQ pool 5–6 sources, paragraphed essay answers, pictorial display

## Status: implemented

## Changes

1. **`supabase/functions/generate-assessment/index.ts`**
   - Bumped SBQ `FETCH_TARGET` from 4 → 5 (so each History/SS SBQ section ships
     with 5 text + 2 images = up to 6 distinct sources, hard-capped at
     poolSize 6).
   - Updated `HISTORY_ESSAY_ANSWER_TEMPLATE` to require explicit blank-line
     paragraph breaks (≥5 paragraphs, `\n\n` separators, no bullet points)
     so the model essay survives rendering as discrete paragraphs.

2. **`src/routes/assessment.$id.tsx`**
   - Mark-scheme "Answer:" now splits on blank lines and renders each block
     as its own `<p>` (font-paper, leading-relaxed, whitespace-pre-wrap),
     so essay model answers display as paragraphs instead of one wall.

3. **Pictorial sources & hyperlinks**: already wired end-to-end (image
   markers parsed in `parseSharedSourcePool`, displayed as `<img>` with
   provenance and clickable "View source ↗" link). No UI change needed —
   the data path was already complete; the only knob to turn was raising
   the text-source target so the section reaches 5–6 total.

### Deployment
`generate-assessment` redeployed.
