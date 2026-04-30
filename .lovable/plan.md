## Goals

1. **LO Coverage classified by KO at a glance** — In the inline LO Coverage card (not just the Explorer dialog), show LOs grouped by their parent KO/topic with covered/uncovered status visible. Each KO group is collapsible so users can drill down into the LOs they care about, instead of one giant flat list.
2. **Tame the long analysis column** — Make AO Coverage, KO Coverage, LO Coverage, Per-section breakdown, **and** Assessment Coach all collapsible at the card level, with sensible defaults so the page doesn't feel like an endless scroll.

Both changes live in `src/routes/assessment.$id.tsx`.

---

## Part 1 — LO Coverage: KO-grouped at-a-glance view

### New default view: "By topic"

Replace the current LO view-mode toggle (`Overview / Map / List`) with a clearer set: **`By topic` (default) · `Map` · `Flat list`**.

**`By topic` rendering** (the new at-a-glance):

- Use the existing `topicsMap` (already computed, has `disciplines → topics → los`).
- For each discipline (e.g. "Chemistry"), render a small section header with `coveredLOs / totalLOs`.
- Under it, render every topic (KO) as a **collapsible row**:

```text
▸ Atomic structure          [donut 4/6]   ●●●○○○   4/6 LOs   [balanced]
▾ Stoichiometry             [donut 3/3]   ●●●●     3/3 LOs   [balanced]
    ✓ Calculate moles from mass …               ×2
    ✓ Apply Avogadro constant …
    ○ Determine empirical formula …          ← red, untested
▸ Bonding                   [donut 0/5]   ○○○○○    0/5 LOs   [untested]
```

- Header row shows: chevron, KO title, mini `CoverageDonut`, `DensityBar`, `covered/total`, status chip (reuse `STATUS_META` colors).
- Expanded body lists each LO with the same ✓ / ○ / ×N affordances that already exist in the matrix view, click → opens the existing `DetailDrawer` via `setTarget({ kind: "lo", ... })`.
- Default: all KO rows **collapsed** so users see the topic-level bird's-eye view first; click any topic to drill.
- A small toolbar above the groups: `Expand all` / `Collapse all`, and a filter pill row reusing `OverviewStatus` (`under / thin / over / balanced / untested`) so users can e.g. show only untested topics.

### Behavior

- Implementation reuses `topicsMap`, `classifyTopic`, `STATUS_META`, `CoverageDonut`, `DensityBar`, and `RemarkPill` — no new data plumbing.
- For non-science papers (`isScience === false`) where `topicsMap.disciplines` is empty, fall back to the current flat list automatically (no toggle shown).
- The existing fullscreen **Coverage Explorer** dialog stays as-is for power use (matrix + drill-down). The "Expand" button continues to open it.

---

## Part 2 — Make every analysis card collapsible

Wrap each of these cards in the existing `Collapsible` primitive (already imported and used for Per-section breakdown):

| Card | Default state |
|---|---|
| AO Coverage | **Open** (most-used summary) |
| KO Coverage | Collapsed |
| LO Coverage | **Open** (this is the headline view; KO rows inside are themselves collapsed) |
| Per-section breakdown | Collapsed (currently first section auto-opens — change so the whole card collapses) |
| Assessment Coach (in the Coach tab) | The Coach card itself stays, but each `CoachSection` (Alignment / Difficulty / Diversity / etc.) becomes a `Collapsible`, default **collapsed** except the first non-empty section. The top "Run Coach / Re-run" controls and `FindingTotals` summary remain always visible. |

### Card-level collapsible pattern

Each card keeps its current outer `rounded-xl border bg-card p-5` shell. The header row (`<h3>` + helper text + action buttons like Re-tag / Expand / view-mode toggle) becomes the `CollapsibleTrigger`, with a chevron that rotates on open. Action buttons inside the header use `e.stopPropagation()` so clicking Re-tag / Expand doesn't toggle the card.

```text
┌─ AO Coverage ─────────────────────  [Re-tag with AI]  ▾ ─┐
│ Marks per Assessment Objective (targets …)              │
│  ── content (meters, lists) ──                          │
└─────────────────────────────────────────────────────────┘
```

When collapsed, the card shows just the title row + a one-line summary (e.g. AO: `8 / 10 AOs on target`; LO: `42 / 60 LOs covered`; KO: `5 / 7 topics balanced`). This gives users a glanceable status without expanding.

### Persistence

Persist open/closed state per assessment in `localStorage` under a single key `origaimi.coverage.collapsed.<assessmentId>` so the user's chosen layout survives reloads. Fall back to the defaults above on first visit.

---

## Technical details

- File: `src/routes/assessment.$id.tsx` only. No schema, no edge function, no new dependencies.
- Replace the LO view-mode tri-state literal (`"overview" | "map" | "list"`) with `"topic" | "map" | "list"`; rename `TopicsOverviewView` usage and add a new `TopicsByKOView` component (or extend `TopicsOverviewView` with a `mode="grouped"` prop). Implementation will likely add a new component below the existing `TopicsOverviewView` to keep the diff readable.
- Use `Collapsible / CollapsibleTrigger / CollapsibleContent` (already imported) for both the per-KO rows and the card-level wrappers. Use `ChevronRight` rotated via `data-[state=open]:rotate-90` (pattern already in the file at line 2440).
- A small `useCollapsibleState(key, defaults)` hook handles localStorage round-tripping for the card-level state; written inline in the same file.
- For the Coach panel: wrap each `<CoachSection>` body in `Collapsible`. `CoachSection` already takes `title` and `count` — extend it with an internal `Collapsible` and a chevron, default open only when `props.defaultOpen` is true (passed by the parent for the first non-empty section).

---

## Out of scope

- No changes to data model, AI prompts, edge functions, or the Coverage Explorer dialog layout.
- No change to the fullscreen Explorer matrix/drill-down modes — they already serve the deep-dive case.
