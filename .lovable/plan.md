## Goal

Make the hover tooltips on the **Scripts assigned per marker** and **Setting load (points)** bars on `/oversight` more useful by **tabulating the information per class**, with the number of subjects and papers shown in parentheses.

## Where this lives

`src/routes/oversight.tsx`, two tooltip bodies:

- Marker bar (`perMarker`) — currently shows: "Classes (n): …", "Levels: …", "Subjects: …", "Papers: …" as comma-joined strings.
- Setter bar (`settingLoad`) — currently shows similar comma-joined lists.

Today, all subjects/papers/classes are listed as flat comma-separated strings, so there's no way to see which paper or subject belongs to which class.

## What changes

Replace the flat lines inside each `<TooltipContent>` with a small table grouped by class:

```
Marker: Mr Tan
Scripts assigned: 120 · Marked: 80

Class            Subjects (n)         Papers (n)
1A1              Math, Sci (2)        EOY P1, EOY P2 (2)
1A2              Math (1)             EOY P1 (1)
2B3              Hist (1)             SA1 (1)
```

Render rules:

- One row per class for that teacher.
- "Subjects" cell lists the unique subjects that appear in papers for that class, with the count in parentheses at the end.
- "Papers" cell lists the unique paper titles for that class, with the count in parentheses at the end.
- If a teacher has classes but no class label was provided, group those under a single "—" / "Unassigned class" row.
- Empty subjects or papers show "—".

## Data shape change

Update the `perMarker` and `settingLoad` `useMemo` reducers to also build a per-class breakdown:

```ts
classBreakdown: Array<{
  classLabel: string;        // e.g. "1A1" or "—"
  subjects: string[];        // unique, sorted
  papers: string[];          // unique paper titles, sorted
}>
```

For markers, the join key is `(teacher_name, class_label)` from `marking_deployments` joined to `marking_papers`. For setters, since setter rows often have no `class_label`, derive the class list by looking at marker rows on the same `paper_id` (we already do this) and group those marker class labels with their paper.

## UI

Use a compact `<table>` inside the existing `<TooltipContent>` (or a CSS grid) with three columns: Class · Subjects (n) · Papers (n). Keep the header row sticky-styled with `text-muted-foreground` and small font (`text-xs`). Cap width to `max-w-md` and allow vertical scroll for very tall tooltips (`max-h-72 overflow-auto`).

## Out of scope

- Changing the visible bars themselves (lengths, colours, ordering).
- Adding new columns like points-per-class or marked-per-class — keep it focused on the requested subjects/papers counts.

## Open question

1. The user mentioned tabulating "subjects" and "papers". I want the cells to**show the count** (just "(2)") for compactness? 
  &nbsp;