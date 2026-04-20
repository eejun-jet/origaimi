
# Origaimi — Brand & Product Concept Integration

Rebranding from "Joy of Assessment" to **Origaimi** and weaving in the four pillars (Effortless Generation, Intelligent Coaching, Curated Inspiration, Precision Alignment) across the app.

## 1. Brand identity

- **Name**: Origaimi (everywhere — header, titles, meta, footer, exports)
- **Tagline**: "Unfold the Joy of Assessing"
- **Logo**: Save uploaded `IMG_2754.png` as `src/assets/origaimi-logo.png`. Use the full lockup on landing hero + auth, and a compact swan-only mark in `AppHeader`.
- **Colour direction**: Tune `src/styles.css` tokens to match the logo — deep navy ink (`#1F3A5F`) as foreground, soft teal-blue (`#7BB3C9`) as primary accent, warm paper off-white (`#F7F4EE`) as background. Keep the existing `font-paper` serif for exam previews.
- **Favicon + meta**: Update `<title>`, OG tags, and favicon to Origaimi.

## 2. Landing page (`src/routes/index.tsx`) — full rewrite around the pitch

New narrative structure, replacing current generic copy:

1. **Hero**: Logo lockup + tagline. Sub-headline: "AI does the paddling. You set the course." CTA: "Start setting" → `/dashboard`.
2. **The Swan section**: Two-column visual — "What you see" (elegant exam paper) vs "What's underneath" (TOS tables, diagram hunting, AO checks). Frames the problem in the user's words.
3. **The Philosophy block**: Decode the name — `Orig` · `AI` · `mi` — three cards, each one sentence. Reinforces human-in-the-loop.
4. **The Four Pillars** (replaces current 6-feature grid):
   - Effortless Generation — guided prompts → questions with diagrams
   - Intelligent Coaching — embedded Assessment Literacy Coach using AO frameworks
   - Curated Inspiration — tagged question repository
   - Precision Alignment — automated TOS checker
5. **Closing CTA**: "No time? No problem. Let AI do the paddling."

## 3. Product surface alignment

Light touch — wire the pillar language into existing screens so the pitch matches the product:

- **Dashboard empty state**: "Ready to unfold a new paper?" with the four pillars as quick-start chips.
- **Blueprint wizard (`/new`)**: Rename Step 3 from "Blueprint" to **"Table of Specifications"** (TOS) — matches the user's vocabulary. Step 5 "References" stays but gets subtitle "Curated inspiration".
- **Architect editor (`/assessment/$id`)**: Rename "Blueprint Compliance Meter" → **"TOS Alignment Meter"**. Add a placeholder "Coach" tab next to the question list (stub for now — surfaces the pillar in UI even before the AO evaluation engine is built).
- **Question Bank (`/bank`)**: Page title "Curated Inspiration · Question Bank".

## 4. Out of scope this round (flag as next)

- Actual AO/Assessment Literacy evaluation engine (the Coach is UI stub only)
- Diagram generation in question output (currently text-only)
- Tag taxonomy for the bank repository (basic metadata only today)

These are real product features from the pitch — worth building next, but each is a meaningful chunk on its own.

## Technical notes

- Copy `user-uploads://IMG_2754.png` → `src/assets/origaimi-logo.png`, import as ES module in `AppHeader.tsx` and `index.tsx`.
- Update colour tokens in `src/styles.css` (`--background`, `--foreground`, `--primary`, `--primary-soft`, `--card`) — keep semantic naming so downstream components inherit automatically.
- Update `head()` meta in `src/routes/__root.tsx` and `src/routes/index.tsx` (title, description, OG tags).
- Rename strings in `new.tsx`, `assessment.$id.tsx`, `dashboard.tsx`, `bank.tsx` — no structural changes, no schema changes.
- Footer year + copyright → "© Origaimi · For Singapore educators".
