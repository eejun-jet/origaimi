# Move "Our Story" content to its own route

## Goal
Keep the landing page (`/`) focused on the hero only. Move the remaining narrative sections (the swan, the philosophy, the four pillars, and the closing CTA) to a new dedicated subpage at `/our-story`, accessible from the top-left navigation.

## Changes

### 1. Create `src/routes/our-story.tsx` (new file)
- New TanStack route with `createFileRoute("/our-story")`.
- `head()` metadata with unique title/description/og tags for the page (e.g. "Our Story — origAImi").
- Renders `<AppHeader />` and contains the four sections currently on the landing page:
  - "The swan, and what's underneath" (with the `Eye` and `Waves` cards)
  - "Why origAImi?" (with the three `NameCard` items)
  - "The engine: four friction points, solved" (with the four `Pillar` items)
  - "No time? No problem." closing CTA linking to `/dashboard`
- Move the `NameCard` and `Pillar` helper components into this file (they're only used by the story content).
- Reuses the same icon imports (`Eye`, `Waves`, `Wand2`, `Compass`, `Library`, `Target`, `ArrowRight`).

### 2. Update `src/routes/index.tsx`
- Remove the "swan", "philosophy", "four pillars", and closing sections.
- Remove the **"The story behind the name"** button under the hero (and its `#swan` anchor link).
- Remove the now-unused `NameCard` and `Pillar` helper functions and unused icon imports (`Eye`, `Waves`, `Wand2`, `Compass`, `Library`, `Target`).
- Keep the hero with its badge, banner image, tagline, and the single primary "Start setting" CTA.

### 3. Update `src/components/AppHeader.tsx`
- Add a new `<Link to="/our-story">Our Story</Link>` in the nav, placed as the first link (top-left side of the nav, before "Assessments") so it reads naturally as an "About" entry.
- Same styling as the other nav links (muted hover, active state bold).

## Notes
- `src/routeTree.gen.ts` is auto-generated — no manual edit.
- No backend or data changes.
- No other routes/components reference the moved sections, so no further cleanup is needed.
