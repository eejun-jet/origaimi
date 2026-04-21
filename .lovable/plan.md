

## Add multi-select + bulk actions to the assessment editor

The assessment editor already has per-question **Edit**, **Delete**, and **Regenerate** buttons working. What's missing is the ability to **select** questions and act on multiple at once. I'll add that, plus tighten a couple of rough edges.

### What you'll see on `/assessment/$id`

1. **Checkbox on every question card** (top-left, next to the "Q1" label).
2. **Selection bar** appears at the top of the question list when ≥1 is selected:
   - "3 selected" counter
   - **Select all** / **Clear** toggle
   - **Regenerate selected** — runs the regenerate edge function on each in sequence (with a single optional instruction prompt)
   - **Delete selected** — confirmation dialog, then bulk delete
   - **Save selected to bank** — bulk-add to question bank
3. **Confirmation dialog before delete** (single or bulk) — currently single-delete fires instantly with no confirm, easy to misclick. I'll add an `AlertDialog`.
4. **Toast feedback** during bulk ops ("Regenerating 3 questions… 1 of 3 done…").

### Technical changes

**File: `src/routes/assessment.$id.tsx`**
- Add `selectedIds: Set<string>` state in `EditorPage`.
- Add `toggleSelect(id)`, `selectAll()`, `clearSelection()` helpers.
- Add `<BulkActionBar>` component rendered above the question list when `selectedIds.size > 0`. Sticky at top of the column.
- Pass `selected` + `onToggleSelect` props into `QuestionCard`; render a `Checkbox` (shadcn) in the card header.
- Add `bulkDelete()`, `bulkRegenerate(instruction)`, `bulkSaveToBank()` in `EditorPage`. Bulk regenerate runs sequentially (not parallel) to respect AI rate limits, with a progress toast.
- Wrap single + bulk delete in `AlertDialog` from `@/components/ui/alert-dialog` (already installed).
- A small "Regenerate selected" dialog reuses the same instruction textarea pattern already used for single regenerate.

**No backend changes needed** — `assessment_questions` already has open RLS for delete/update, and `regenerate-question` edge function already exists and works per-question.

### Layout sketch

```text
┌─ Q1 ─────────────────────────────────────────┐
│ ☐  Q1  [structured] [Topic] [Apply] [4]      │   ← checkbox added
│ ───────────────────────────────────────────  │
│ Question stem...                              │
│ [Edit] [Regenerate] [Save to bank] [Delete]   │   ← per-card actions stay
└──────────────────────────────────────────────┘

When ≥1 selected, sticky bar at top:
┌──────────────────────────────────────────────┐
│ 3 selected   [Select all] [Clear]            │
│              [Regenerate] [Save to bank] [Delete] │
└──────────────────────────────────────────────┘
```

### Out of scope (ask if you want these too)
- Drag-and-drop reordering (current up/down arrows stay)
- Inserting a brand-new question manually
- Cross-assessment bulk operations (this is single-assessment only)

