## Goal
Use the uploaded swan + wordmark image as the new hero banner on the landing page (`/`).

## Heads up — brand spelling
The uploaded image reads **"origami — Unfold the Joy of Assessing"**, but the project's core brand rule is **origAImi** (capital "AI" in the middle). Using this image as-is would contradict the brand spelling shown everywhere else in the app.

Two options — I'll go with (A) unless you tell me otherwise:

- **(A) Use the image as-is** for the hero. Fast, matches your request literally. Brand spelling on the hero will differ from the rest of the app.
- **(B) Use the image but keep the "AI" treatment** by overlaying/adjusting later, or asking you for an updated asset that says "origAImi".

## Changes

1. **Add the asset**
   - Copy `user-uploads://45fdec5a-...jpg` → `src/assets/hero-banner.jpg`.

2. **Update `src/routes/index.tsx` hero section**
   - Replace the current stacked layout (small logo + "Unfold the joy of assessing" headline + subheadline) with the new banner image as the dominant hero visual.
   - Render the banner full-width inside the existing `max-w-6xl` container, with rounded corners and a subtle border to match the card aesthetic.
   - Remove the now-redundant small `<img src={logo}>` and the `<h1>Unfold the joy of assessing</h1>` (the banner already contains both the logo and the tagline).
   - Keep: the "Human-in-the-loop AI for Singapore educators" chip (above the banner), the supporting paragraph (below the banner), the two CTAs ("Start setting" / "The story behind the name"), and the fine-print line.
   - Add proper `alt` text and `loading="eager"` + `fetchpriority="high"` for LCP.

3. **Metadata** — no changes needed; existing `head()` title/description still apply.

## Out of scope
- No changes to `AppHeader` logo, other routes, or the rest of the page sections (Swan story, Philosophy, Pillars, Close).
