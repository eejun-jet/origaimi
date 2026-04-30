## Problem

The right-rail LO Coverage card is too cramped to show 10–20 KOs at once. The current Overview / Map / List toggle compresses everything into a narrow sidebar, so the relationship between KOs (Knowledge Outcomes) and the LOs (Learning Outcomes) inside each KO is unreadable.

## Goal

Let the user click an "Expand" button on the LO Coverage card to open a large modal-style explorer that shows:

1. **All KOs at a glance** — grid of cards, each with status (Untested / Under-tested / Thin / Balanced / Over-tested), covered/total LO count, and marks.
2. **Drill-down on click** — clicking a KO card opens a second pane (or full-screen detail) listing every LO under that KO, with covered/uncovered status, marks, and remarks.
3. **Back-out / pick another KO** without closing the dialog.
4. Existing right-rail card stays as a quick summary; nothing else changes.

## UX flow

```
┌──────────────────────────────────────────────────────────┐
│ Coverage explorer                              [×]       │
│ Filters: [All ▾] [Untested] [Thin] [Balanced] [Over]     │
├──────────────────────────┬───────────────────────────────┤
│  KO grid (left, 60%)     │  Selected KO detail (right)   │
│ ┌────────┐ ┌────────┐    │  Cells / Atoms                │
│ │ Cells  │ │ Atoms  │    │  3/8 LOs covered · 12 marks   │
│ │ ●●●○○○ │ │ ●●●●●○ │    │  ─────────────────────────   │
│ │ 3/6 LO │ │ 5/6 LO │    │  ✓ LO text 1     2× · 4m     │
│ │ Thin   │ │ Balanced   │  ○ LO text 2     0× · 0m     │
│ └────────┘ └────────┘    │  …                            │
│ ┌────────┐ ┌────────┐    │  [Open remarks] [Jump to Q]  │
│ │ Forces │ │ Energy │    │                               │
│ └────────┘ └────────┘    │                               │
└──────────────────────────┴───────────────────────────────┘
```

On narrow screens the right pane stacks below; on wide screens it sits beside the grid.

## Implementation

**File: `src/routes/assessment.$id.tsx`**

1. Add an "Expand" icon-button (Lucide `Maximize2`) next to the existing Overview/Map/List toggle in the LO Coverage card header (around line 2218–2249).
2. Add state `const [explorerOpen, setExplorerOpen] = useState(false);` and `const [explorerKO, setExplorerKO] = useState<string | null>(null);` in `CoveragePanel`.
3. Render a new `<Dialog>` (shadcn) when `explorerOpen` is true. Use `DialogContent` with `max-w-6xl` and `h-[85vh]` so it feels full-screen on the user's 883px viewport but scales up on larger monitors.
4. Inside the dialog, two-column flex (`md:grid md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]`):
   - **Left** — KO grid built from `coverage.paper.kos`, plus per-KO LO stats derived by walking `topicsMap` to find which LOs belong to each KO. Each card shows: KO name, marks (`actual / target`), covered/total LO count, status chip via `classifyTopic`, and a `SegmentBar` for visual density. Clicking a card sets `explorerKO`.
   - **Right** — when `explorerKO` is set, list LOs for that KO using the same row UI as the existing list view (✓/○, text, marks count, RemarkPill). Each row stays clickable and reuses `setTarget({ kind: "lo", ... })` so the existing DetailDrawer still opens for evidence + comments. Empty state when nothing selected ("Pick a Knowledge Outcome to see its Learning Outcomes").
5. Filter chips at the top (All / Untested / Thin / Balanced / Over) reuse `OverviewStatus` + `STATUS_META`.
6. The existing right-rail card and DetailDrawer remain untouched — the explorer is purely an additional surface that reuses the same state setters.

**KO → LO grouping**

KOs already exist in `coverage.paper.kos`. To list LOs *inside* a KO we need the mapping. Two sources are available:

- `questions.knowledge_outcomes` + `questions.learning_outcomes` per question (already loaded). Build a `Map<koName, Set<loText>>` once with `useMemo`.
- Fallback: any LO not associated with a KO goes into a synthetic "Unassigned" KO group at the end.

This keeps the explorer accurate even when the syllabus topic_pool doesn't enumerate KOs explicitly.

## Out of scope

- No data-model changes, no backend changes.
- AO and Paper-overview cards stay as they are; the user's complaint is specifically about LO/KO readability.
- Mobile (<768px) gets the stacked layout automatically; no separate design.

## Files touched

- `src/routes/assessment.$id.tsx` — add Expand button, dialog, KO grid component, LO detail pane, KO→LO memo.

No new dependencies; `Dialog`, `Maximize2`, and existing helpers (`classifyTopic`, `STATUS_META`, `SegmentBar`, `RemarkPill`, `DetailDrawer`) are already in the project.
