## Goal

Two things on top of the existing oversight work:

1. A **clean, logo-less XLSX template** users can drop their data into, now with an **Assessment** column (WA1/WA2/MYE/EoY/CA1…).
2. A **year-round points system** that scores each teacher's contribution to setting, marking, and moderation across the whole year — not just EoY.

## Default points table (hard-coded)

```text
Setting
  G3 / Sec Exp / Upper Sec full paper        2.0
  G2 / Sec NA — variant of a G3 paper        1.0   (auto-detected)
  G2 / NA standalone (no G3 sibling)         1.5
  G1 / NT paper                              1.0
  WA (term assessment, any level)            1.0
  MYE                                        1.5
  EoY / Prelim                               2.0   (already covered above when full paper)
  Co-setter                                  points / number of setters

Marking
  Per script                                 0.02
  + per class assigned                       0.25   (fixed-cost overhead)
  Co-marker on same class                    points / co-markers

Moderation
  Per paper moderated                        0.5
  Per script sampled (when scripts table is used)   0.05
```

These live in `src/lib/marking-points.ts` as a pure function `computePoints(paper, deployment)` — easy to tweak later, no admin UI needed for v1.

## G2-variant auto-link

When papers are created during import, we group rows in the same import by `(department, subject, year)` and look at their `level`/`stream`:

- If both a G3/Exp and a G2/NA paper exist → tag the G2 one as `variant_of = <G3 paper id>`, score it 1.0.
- If only G2/NA exists → standalone, score 1.5.
- Same logic across imports: when inserting a new G2 paper, look up an existing G3 sibling for that `(dept, subject, year)`; when inserting a G3, back-fill any orphan G2 sibling.

## Template shape (logo-less)

`public/templates/setters-markers-template.xlsx`, generated once via `scripts-tmp/build-marking-template.mjs`:

```text
Row 1 : Setters & Markers Deployment — <School / Department>     (title, merged)
Row 2 : Department: ____   |  Year: ____   |  Default Assessment: WA1 / WA2 / MYE / EoY
Row 3 : (blank)
Row 4 : SN | Assessment | Level | Subject | Duration | Setter(s) |
        Marker(s) | Classes | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Total | Remarks
Rows 5-7 : 3 grey-italic example rows (single marker, co-markers, multi-class)
Bottom block : "How to fill this in" notes (co-markers with /, classes comma-separated,
               assessment values, blank Level/Subject continues previous paper)
```

A "Download blank template" link is added to the upload card at `/oversight/import`.

## Schema changes (one migration)

```sql
-- new columns
alter table marking_papers
  add column assessment_type text,        -- 'WA1' | 'WA2' | 'MYE' | 'EoY' | 'CA1' | free text
  add column variant_of uuid references marking_papers(id),
  add column points_setting numeric;       -- cached, recomputed on write

alter table marking_deployments
  add column points numeric default 0;     -- cached per (teacher × class × role)

-- view that aggregates per teacher across the year
create view teacher_points_year as
select
  coalesce(d.teacher_id::text, d.teacher_name) as teacher_key,
  d.teacher_name,
  p.year,
  p.department,
  sum(case when d.role = 'setter'    then d.points else 0 end) as setting_points,
  sum(case when d.role = 'marker'    then d.points else 0 end) as marking_points,
  sum(case when d.role = 'moderator' then d.points else 0 end) as moderation_points,
  sum(d.points) as total_points
from marking_deployments d
join marking_papers p on p.id = d.paper_id
group by 1,2,3,4;
```

`role` already accepts free text — we'll start using `'moderator'` alongside the existing `'setter'`/`'marker'`.

## Import + recompute flow

1. Parser (`src/lib/marking-import.ts`) gains an `Assessment` column. Falls back to the form's default (e.g. user picks "EoY 2026" on the upload form) when blank.
2. After insert, run `recomputePoints(paperIds)` server-side:
   - resolve G2↔G3 siblings, set `variant_of`,
   - compute `points_setting` per paper and `points` per deployment,
   - write back.
3. Idempotent: re-running on the same papers just refreshes the cached numbers.

## Dashboard additions

`/oversight` (existing route) gets two new pieces:

- **KPI strip** — add "Points awarded YTD" tile.
- **Year filter** + **Assessment filter** (multi-select WA1/WA2/MYE/EoY/…).
- **Teacher leaderboard panel** (new component): table of teachers with columns *Setting · Marking · Moderation · Total*, sortable, with a stacked-bar mini-chart per row. Clicking a teacher opens the existing per-teacher drawer, which now lists every paper/class they touched that year and the points each line contributed.

A new mini-route `/oversight/points` shows a printable, full-page version of that leaderboard for HOD/SL end-of-year reviews.

## Files

**New**
- `src/lib/marking-points.ts` — defaults table + `computePoints()` + `recomputePoints()` server fn
- `scripts-tmp/build-marking-template.mjs` — generates the XLSX
- `public/templates/setters-markers-template.xlsx` — the artifact
- `src/components/TeacherPointsLeaderboard.tsx`
- `src/routes/oversight.points.tsx`

**Edited**
- `supabase/migrations/...` — columns + view above
- `src/lib/marking-import.ts` — parse `Assessment` column, default-from-form fallback
- `src/routes/oversight.import.tsx` — Assessment default selector + template download link
- `src/routes/oversight.tsx` — Points KPI tile, year/assessment filters, leaderboard panel

## Out of scope (v1)

- Admin UI to edit point rules (defaults only — change via code).
- Pro-rating for partial-year staff.
- Exporting the leaderboard back to XLSX (printable view is enough for now).
- Per-script moderation points (only paper-level moderation until `marking_scripts` is populated in real use).
