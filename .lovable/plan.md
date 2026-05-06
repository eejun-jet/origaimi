# Switch KO/LO coverage status to %-based with relative Over-tested

## New rule (single source of truth)

For each topic, `pct = coveredLOs / totalLOs`. Paper-wide `avgPct` = mean of `pct` across all topics with ≥1 LO (whole paper, all disciplines).

| Status | Rule | Color |
|---|---|---|
| Untested | `pct === 0` | red (destructive) |
| Thin | `0 < pct < 0.40` | amber |
| Balanced | `0.40 ≤ pct ≤ 0.80` | blue |
| Tested | `pct > 0.80` and not Over-tested | green (success) |
| Over-tested | `pct > 0.80` AND `avgPct < 0.70` AND `pct − avgPct ≥ 0.30` | purple |

The "Under-tested" status is removed (it collapses into Thin under the new % rule).

## File: `src/routes/assessment.$id.tsx`

### 1. Replace `OverviewStatus`, `classifyTopic`, and `STATUS_META` (lines ~2313–2336)
- New union: `"untested" | "thin" | "balanced" | "tested" | "over"`.
- `classifyTopic(los, avgPct)` — accepts the paper-wide average and follows the rules above.
- New helper `computeAvgPct(topics)` — mean of per-topic coverage % across topics with ≥1 LO.
- `STATUS_META` updated:
  - Sort order: untested (0), thin (1), balanced (2), tested (3), over (4) — issues first.
  - Colors: red / amber / blue / green / purple via Tailwind utility classes (`bg-blue-500/15 text-blue-700 …`, `bg-purple-500/15 text-purple-700 …`).

### 2. Update three call sites that classify topics
All three need access to a paper-wide `avgPct`:

- **Line ~2412** (`KOLOOverviewCompact` / legend block, simple list): compute `avgPct` once from `map.disciplines.flatMap(d => d.topics)` before the disciplines map, then pass to `classifyTopic(t.los, avgPct)`.
- **Line ~2551** (Coverage section with filter pills): same — compute `avgPct` from `map.disciplines.flatMap(d => d.topics)` in the component scope.
- **Line ~3104** (inside the `koLoGroups` `useMemo` for the full Coverage Explorer): two-pass — first build `buckets` without `status`, compute `avgPct` from those buckets' `los`, then assign `status: classifyTopic(b.los, avgPct)` in a second pass before sort.

### 3. Update legend (line ~2394)
Reorder to match new sortKey: `["untested", "thin", "balanced", "tested", "over"]`. Removes "under".

### 4. Update filter pill arrays
- **Line ~2517** in the Coverage section: `["all", "untested", "thin", "balanced", "tested", "over"]`.
- **Lines ~3566–3573** in the Coverage Explorer: replace `under-tested` entry with `tested`, drop "Under-tested", add "Tested" between Balanced and Over-tested.

### 5. Spot-check other usages
- `KoBucket` type uses `status: OverviewStatus` — type narrows automatically.
- The `"thin"` inline badge at line ~2693 stays as-is (still a valid status).
- No backend / DB changes; classification is pure UI.

## Why this is clearer for the user

- One simple % ladder for the four primary states — no more hidden rules about "3+ questions on one LO" or "topic must have ≥3 LOs".
- Over-tested is now a *relative* signal, exactly as discussed: it only fires when this topic is meaningfully ahead of the paper average and the paper isn't broadly well-covered already.
- Distinct color per state (red / amber / blue / green / purple) so users can scan the donut grid at a glance.
