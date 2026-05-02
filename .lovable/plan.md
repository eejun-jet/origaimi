# Mobile-optimise the assessment editor

Four targeted polish passes on the screens teachers actually open on a phone. Everything stays responsive on desktop — the changes only kick in below `md` (768 px) or `sm` (640 px) where stated. No new dependencies; uses the shadcn `Sheet`, `DropdownMenu`, and existing `useIsMobile()` hook already in the codebase.

## 1. Editor sidebar → mobile bottom sheet

**File:** `src/routes/assessment.$id.tsx`

The right rail (Coverage tab + Comments tab + BlueprintTargetsCard + CoachPanel + Total marks) currently stacks below the question list on mobile, forcing a long scroll. Replace with:

- On `md+` (≥768 px): keep the existing 2-column sticky aside as-is.
- On `<md`: hide the aside (`hidden md:block` on the existing `<aside>`), and render a **sticky bottom action bar** pinned above the safe area:

  ```text
  ┌──────────────────────────────────────────────┐
  │  ▣ Coverage   💬 Comments (2)   ✦ Coach      │
  └──────────────────────────────────────────────┘
  ```

  Each button opens a `Sheet` (`side="bottom"`) with `max-h-[85vh] overflow-y-auto`. Inside the sheet we render the same `<CoveragePanel>` / `<CommentDock>` / `<CoachPanel>` components — no duplication of state or props.

- The unread comment count + "AOs on target" summary surface as small badges on the bar buttons so teachers see status without opening anything.
- The bar uses `pb-[env(safe-area-inset-bottom)]` and a translucent `bg-background/95 backdrop-blur` border-top for an iOS-feeling chrome.

## 2. Header actions → overflow menu on mobile

**File:** `src/routes/assessment.$id.tsx` (lines ~603–763)

The header row currently shows: Download .docx, Download TOS ▾, Invite reviewer, Status select. On phones these wrap to two ragged rows.

- On `sm+`: keep the current inline layout.
- On `<sm`: collapse Download .docx, TOS Excel, TOS Word, and Invite reviewer into a single "Actions ⋯" `DropdownMenu`. The Status select stays inline (it's the most-used control and reads cleanly at narrow widths).

The TOS Excel/Word options become first-level items in the same dropdown rather than a nested submenu — flatter is better on touch.

## 3. Stack Coverage rows + BlueprintTargetsCard under 480 px

**Files:** `src/components/BlueprintTargetsCard.tsx`, `src/routes/assessment.$id.tsx` (CoveragePanel meter rows)

`BlueprintTargetsCard` uses `grid-cols-[3rem,1fr,5rem,4rem]` which gets cramped under ~360 px (the % input shrinks below readability and "≈ X m" overflows). Change to:

- Mobile: `grid-cols-[3rem,minmax(0,1fr),auto]` with the AO title spanning two columns on row 1 and the input + marks-hint sharing row 2.
- `sm+`: original 4-column layout.
- Bump the input from `h-7` to `h-8` so it meets the 32 px touch-target minimum.

For the `MeterRow` component used inside `CoveragePanel`'s AO/KO/LO cards, ensure long titles wrap (`break-words`) and the actual/target numbers stay right-aligned in their own row on `<sm`.

## 4. Question card actions → overflow menu on mobile

**File:** `src/routes/assessment.$id.tsx` (`QuestionCard`, lines ~1576–1602)

Five buttons in the action footer (Edit, Regenerate, Save to bank, Comment, Delete) wrap to two rows on phones. Change to:

- On `sm+`: keep the current `flex flex-wrap gap-1` row.
- On `<sm`: render only **Edit** and **Comment** (the two highest-frequency actions) inline, then a **"⋯ More"** `DropdownMenu` that holds Regenerate, Save to bank, and Delete. Delete keeps its destructive-red styling inside the menu.

The header-area edit/regenerate buttons (lines 1318–1340) are already mobile-aware (`hidden sm:inline` on the labels) so they don't need changes.

## Technical details

- `useIsMobile()` from `src/hooks/use-mobile.tsx` already exists. Use it for #1 (the bottom bar needs to know whether to render). For #2, #3, #4 we use Tailwind responsive classes only — no JS branching, so SSR is clean.
- The bottom sheet uses Radix's `Sheet` (`side="bottom"`); each instance owns its own `open` state via `useState`. State within the panels (active coverage card, comment scroll position) is preserved because we mount the panels lazily but keep them in the DOM once opened, using a `mounted` ref.
- Touch targets: all primary buttons use `size="sm"` which is 32 px high — already meets the 32 px Apple/Material minimum. Icon-only buttons get `aria-label`s.
- Z-index: bottom bar sits at `z-30` so it stays above question cards but below the existing selection bar (`z-20` is fine because they're never visible together — selection bar shows only when items are selected, and the bottom bar can shift up by `top-auto bottom-14` in that case).
- No changes to backend, exporters, computeCoverage, or any data flow.

## Files touched

- `src/routes/assessment.$id.tsx` — bottom bar + Sheets, header overflow menu, QuestionCard overflow menu (3 of 4 changes)
- `src/components/BlueprintTargetsCard.tsx` — responsive grid

## Out of scope

- Builder (`/new`), Bank, Papers, Dashboard, and Auth pages — all already work fine on the current viewport per inspection. Happy to add a follow-up pass if you spot specific pain points there.
- Sidebar primitive replacement — we don't need the shadcn `Sidebar` here; a `Sheet` is the right pattern for a context panel that's hidden by default on mobile only.
- Drag-to-reorder questions on touch (the up/down chevrons already work on mobile).
