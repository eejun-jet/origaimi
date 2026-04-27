## Problem

For science papers (especially Combined Science 5086, which mixes Physics + Chemistry across many topics), the **LO Coverage** card in the assessment sidebar shows a long, flat list of every learning outcome. With 60+ LOs there is no way to scan which **topics** are well covered, which are thin, and which are completely missing — exactly the question teachers ask first.

## Solution

Add a grouped "Topics map" visualisation to the Coverage panel that only renders for science papers. It groups every LO in the paper's pool by **discipline → topic strand → LO**, with a coverage indicator at every level.

Existing flat AO / KO / LO cards stay (they're useful for quick numeric checks). The Topics map becomes the default sub-view inside the LO card so teachers see the structured map first and can collapse/expand sections at will.

### Layout (inside the existing LO Coverage card)

```text
LO Coverage                         42 / 68 outcomes covered  [Map | List]
─────────────────────────────────────────────────────────────────────────
▼ Physics                           18 / 32 ●●●●●○○○○○
   ▼ Dynamics                        4 / 4  ●●●●  (all covered)
       ✓ Newton's laws of motion          (3 questions)
       ✓ Effects of resistive forces      (1 question)
   ▼ Energy                          1 / 5  ●○○○○  ⚠ thin
       ✓ Energy stores and transfers      (1)
       ✗ Work
       ✗ Power
   ▶ Electric Charge & Current      0 / 10 ○○○○○○○○○○  ⚠ uncovered
▼ Chemistry                         24 / 36 ●●●●●●●○○○
   ▶ Chemical Bonding                7 / 11 …
   …
```

- Discipline rows (Physics / Chemistry / Biology / Practical) come from `SectionTopic.section` — already populated for 5086.
- Topic rows come from `SectionTopic.topic` (the strand title from `syllabus_topics`).
- Each row shows `covered / total` LOs, a tiny segment bar, and a colour status:
  - green = fully covered
  - amber = partially covered
  - red = no LOs covered (uncovered topic — the key signal teachers want)
- Topics with 0 coverage auto-expand; fully-covered topics start collapsed; partial topics start expanded.
- Clicking an LO opens the existing DetailDrawer (evidence questions + remarks) — same behaviour as today.
- The "List" toggle keeps the current flat list available as a fallback.

### When the Topics map shows

- Only when `isScienceSubject(assessment.subject)` is true. Humanities papers keep today's flat list (their LOs are typically already short).
- Within science papers, the map appears even on single-discipline papers (Physics-only, Chemistry-only) — the discipline row simply collapses to one group, and the topic grouping is still the win.

## Technical Plan

All changes are confined to `src/routes/assessment.$id.tsx` (with one tiny helper in the same file). No DB / edge-function / migration work — the data is already in the section's `topic_pool` (each `SectionTopic` carries `topic`, `section` discipline, and `learning_outcomes`).

### 1. New grouped data model (helper next to `computeCoverage`)

Add `buildTopicsMap(coverage, sections)` returning:

```ts
type TopicsMap = {
  disciplines: {
    name: string;          // "Physics" | "Chemistry" | "Biology" | "Practical" | "General"
    totalLOs: number;
    coveredLOs: number;
    topics: {
      title: string;       // strand title from SectionTopic.topic
      totalLOs: number;
      coveredLOs: number;
      los: { text: string; covered: boolean; actual: number }[];
    }[];
  }[];
};
```

Build it by walking every `section.topic_pool[].learning_outcomes`, indexing each LO by `(discipline, topic)`, then joining against `coverage.paper.los` to get the covered/actual flags. LOs that come from question tags but have no matching pool topic fall into a synthetic "Other" topic under "General" so nothing is dropped.

### 2. New `TopicsMapView` component

Renders the disciplines → topics → LOs tree. Uses existing primitives:

- `Collapsible` from `@/components/ui/collapsible` (already used elsewhere) for expand/collapse.
- The same row-button pattern + `RemarkPill` + `setTarget({ kind: "lo", … })` plumbing the flat list uses, so clicking an LO still opens the existing DetailDrawer with evidence + comments.
- Tiny segment bar = `flex` of N divs (`bg-success` for covered, `bg-muted` for not), capped at ~12 segments with a "+N" suffix when topics are big.
- Status badge: `success` / `warn` / `destructive` tones using existing tokens.

### 3. Wire it into `CoveragePanel`

In the LO card (around line 1795–1820 of `assessment.$id.tsx`):

- Add a `useState<"map" | "list">` toggle, defaulting to `"map"` for science subjects, `"list"` for everything else.
- Pass `assessment.subject` into `CoveragePanel` (currently it's not passed; just thread it from the parent at line ~870 alongside `coverage`).
- Render the toggle (two small `Button`s) only when `isScienceSubject(subject)` is true — humanities papers see the existing list with no toggle.
- Render `<TopicsMapView />` or the existing `<ul>` of LOs based on the toggle.

### 4. No regressions

- AO Coverage and KO Coverage cards above are unchanged.
- Comments / remarks for LOs continue to use the same `target_kind: "lo"` + `target_key: coverageKey("lo", lo.text)` keys, so existing remarks attach to the same LOs in the new view.
- `computeCoverage` itself is untouched — the topics map is a pure derivation from its output plus the section pool metadata.

### Files touched

- `src/routes/assessment.$id.tsx` — add `buildTopicsMap`, add `TopicsMapView`, add `subject` prop + toggle to `CoveragePanel`, pass `assessment.subject` from the call site.

That's it — single-file change, ~150 lines added, fully reversible via the View toggle.
