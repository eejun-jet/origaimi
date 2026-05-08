## Goal

On `/dashboard`, make the three sub-sections (Paper sets, WA plans, Paper assessments) visually consistent and clearly separated.

## Changes (single file: `src/routes/dashboard.tsx`)

### 1. Standardise tile style — follow "WA plans"

Apply the WA-plan tile look to all three sections:

- Tile shell: `block rounded-lg border border-border px-3 py-2 pr-9 hover:border-primary/40`
- Title: `text-sm font-medium truncate`
- Meta line: `text-xs text-muted-foreground truncate` (joined with " · ")
- Footer line: `mt-1 flex items-center gap-2 text-[11px] text-muted-foreground` (counts/marks/duration + "Updated <date>")
- Status pill: render inline at the top-right corner only for assessments (small Badge)
- Hover trash icon (top-right `absolute`, opacity-0 → group-hover:opacity-100), same as WA tiles
- Use `<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">` for all three

This means **replacing the current large `AssessmentCard`** (with subject icon block, line-clamp title, bottom-right delete button) with the compact WA-style tile. Paper sets already use the compact tile and gain the count/updated footer + hover delete.

### 2. Section containers — colour-coded borders

Wrap each section in a card whose left border + icon colour matches its CTA button:

```text
Paper sets      → violet  (matches "Review paper set" button)
WA plans        → teal    (matches "Generate WA idea" button)
Assessments     → primary (matches "Create new assessment" button)
```

Implementation: section uses `rounded-xl border bg-card p-4 border-l-4 border-l-violet-600` (and `border-l-teal-600`, `border-l-primary` respectively). Section heading keeps the existing icon + title + muted subtitle pattern, with the icon tinted to match.

### 3. Section ordering & headings

Order: Paper sets → WA plans → Assessments. The Assessments section absorbs the existing search/filter row at the top of its card, then renders the tile grid (or skeleton / empty state) below — so the filters visibly belong to that section instead of floating between sections.

### 4. Empty / loading states

Keep current behaviour but render inside the section card so the colour border still frames the area:
- Loading: 3 skeleton tiles
- Empty (assessments): keep current `EmptyState` but place it inside the assessments section card

Paper sets and WA plans sections continue to render only when non-empty (unchanged).

## Out of scope

- No DB or types changes
- No changes to `/authentic/$id` or other routes
- No changes to the header CTAs (already coloured correctly)

## Risk

Low — pure presentation refactor in one file.
