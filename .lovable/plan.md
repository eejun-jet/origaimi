# Per-KO indicative content (history / SS)

## Problem
History/SS syllabuses carry a lot of factual content (events, case studies, dates) that isn't an LO and doesn't fit cleanly under a topic title. Putting it inline on every topic card breaks visual consistency with Combined Science. We want it hidden by default but one click away, scoped per KO category (Knowledge / Understanding / Skills).

## Data model
Add one JSONB column to `syllabus_topics`:

- `ko_content jsonb` — shape `{ "Knowledge": string[], "Understanding": string[], "Skills": string[] }`. Defaults to `{}`. Keys are the same KO labels already used in `outcome_categories`, so a missing key = no extra content for that KO.

No existing data migration needed; column is nullable / defaults to empty.

## UI — admin.syllabus.$id.tsx

The topic card today renders a single row of KO badges (`{(t.outcome_categories ?? []).map(...)}`). Replace each KO badge with a small button that:

- Looks identical to today's `<Badge variant="secondary">` when there is no content under that KO (no chevron, no count).
- When `ko_content[KO]` has items, renders the badge with a faint count suffix (e.g. `Knowledge · 12`) and a subtle dotted underline so users learn it's clickable.
- Click → opens a `Popover` (existing `src/components/ui/popover.tsx`) anchored to the badge, showing:
  - Header: "Indicative content — {KO}".
  - Editable list (one item per line in a `Textarea`, like LOs are edited elsewhere). Add / remove handled by line-splitting on save.
  - In read-only mode (non-edit), render the items as a `<ul>` for clean scanning.

Cards stay visually identical to Combined Science when no extra content is attached. Authors only see complexity when they ask for it.

```text
[topic card]
  Title ............................................. ⋮
  Learning outcomes
    • LO 1
    • LO 2
  [Knowledge · 12]  [Understanding · 5]  [Skills]   ← badges
                ^click → popover with list / editor
```

## Files to change
- New migration: add `ko_content jsonb default '{}'::jsonb` to `syllabus_topics`.
- `src/lib/syllabus-data.ts` — include `ko_content` in selects + mapper.
- `src/routes/admin.syllabus.$id.tsx`:
  - Extend `Topic` type with `ko_content: Record<string, string[]>`.
  - Replace the KO badge map with a new `<KOContentBadge>` inline component using `Popover` + `Textarea`.
  - Wire save through existing `updateTopic` flow (persist `ko_content` alongside the other topic fields).
- `src/integrations/supabase/types.ts` regenerates automatically.

## Out of scope (for this pass)
- Surfacing `ko_content` inside the generator prompt or coverage explorer. We can wire that in a follow-up once authoring is live — flag if you want it bundled.
- LO-level content. Per your input, this lives at the KO level only.
