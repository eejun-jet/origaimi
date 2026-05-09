## Goal

Give HODs and School Leaders visibility into the exam-marking workflow — who's setting, who's marking, how many scripts each teacher has, and how far along they are — modelled on the school's existing **Setters/Markers List** spreadsheet (sample: 2019 Humanities) so HODs can drop their current file in.

## Sample shape we're matching

The school's spreadsheet keys on:

```
SN | Level (Sec 1 Exp / Sec 1 NA / Sec 3 NT) | Subject | Duration |
Setter(s) | Marker(s) | Classes | per-class scripts (1..10) | Total | Remarks
```

Things the schema must handle:
- Distinct **Setter** vs **Marker** roles for the same paper
- Co-marking, written as `"Saramma Matthews/Chen Huifen"` — split into rows
- Multiple markers per paper, each with their own classes (one row per marker × class)
- Stream tagging on level (Exp / NA / NT)
- Department-scoped sheet (this one = Humanities)
- Per-class script counts, with a "Total" rollup
- Free-text "Remarks" (e.g. `MCQ`)

## Phase 1 — Roles & departments (migration)

```text
app_role enum: 'teacher' | 'hod' | 'sl' | 'admin'
```

- `user_roles(user_id, role, department, school)` — separate from `profiles` (avoids privilege escalation)
- `has_role(_user_id, _role)` security-definer fn for RLS, plus `is_hod_of(dept)` / `is_sl_of(school)` helpers
- Add `department text`, `school text`, `display_name text` to `profiles`
- `teacher_aliases(profile_id, alias)` to resolve names like "Chen Huifen" from a CSV/XLSX cell to a profile

## Phase 2 — Marking domain (migration)

- **`marking_papers`** — one per (assessment OR free-text title) × level × subject × stream
  - `assessment_id` (nullable — for papers not yet built in origAImi), `title`, `subject`, `level`, `stream` (Exp/NA/NT), `duration_minutes`, `department`, `school`, `remarks`
- **`marking_deployments`** — one row per **marker × class** (the granular unit)
  - `paper_id`, `role` ('setter' | 'marker'), `teacher_id`, `class_label` (e.g. `3A2`), `script_count` (assigned), `due_at`,
    `status` (`assigned` / `in_progress` / `marking_done` / `moderated`), `marked_count`, `flagged_count`
- **`marking_scripts`** (v1.5, optional) — per-student rows
  - `deployment_id`, `student_ref`, `marked_at`, `marks_awarded`, `flagged`, `flag_reason`, `moderated_at`, `moderator_id`
- **`marking_imports`** — log of XLSX/CSV imports (filename, dept, semester, row count, errors)

RLS via `has_role`:
- Teacher: read/write only own deployments
- HOD: read all in own department
- SL: read all in own school
- Admin: full

## Phase 3 — Import (XLSX/CSV) matching the sample

- Server fn `importDeploymentXlsx` (`createServerFn` + `requireSupabaseAuth`, HOD/admin only)
- Parse with the `xlsx` package (run server-side)
- Expected headers: `Level`, `Subject`, `Duration`, `Setter(s)`, `Marker(s)`, `Classes`, per-class counts (`1..10`), `Total`, `Remarks`
- Splitting rules:
  - Split `Marker(s)` cell on `/` → one row per marker
  - Split `Classes` on `,` → one deployment row per (marker × class)
  - Per-class counts map to that class's `script_count`
- Resolve teacher names → profiles via `display_name` + `teacher_aliases`; unmatched names go to a "needs review" panel
- Show import preview (rows parsed, warnings, unmatched names) → user confirms → insert `marking_papers` + `marking_deployments`
- Downloadable template (XLSX) on the import page

## Phase 4 — Oversight dashboard `/oversight`

New top-level route, gated to `hod` / `sl` / `admin` in `_authenticated` layout via `beforeLoad` + role check (mirrors how protected loaders are scoped today).

### KPI strip
Total papers · setters deployed · markers deployed · scripts assigned · scripts marked · % complete · overdue · flagged

### Deployment table (default)
Columns: Subject · Level/Stream · Paper · Setter · Marker · Classes · Scripts assigned · Marked · Remaining · Status · Due

Filters: subject, level, stream, marker, status, "overdue only", "flagged only"; SL adds department filter.

### Per-teacher drawer
- Stacked bar (assigned / marked / flagged / moderated) per teacher
- Avg turnaround per script
- Click → all deployments for that teacher across papers

### Per-paper drawer
- Coverage: which markers, % complete, moderation status
- Co-marker pairing visible
- Flagged-script feed (when scripts table is populated)

### Header nav
Add "Oversight" link in `AppHeader` for hod/sl/admin only.

## Phase 5 — Teacher touchpoints

- On `/assessment/$id`, "My marking" panel listing deployments for the signed-in teacher
- "Update progress" form: enter `marked_count`, mark complete, flag scripts with reason
- HOD on oversight table can stamp `moderated`

## Files to create / change

- `supabase/migrations/...` — `app_role`, `user_roles`, `has_role`, `is_hod_of`, `is_sl_of`, `marking_papers`, `marking_deployments`, `marking_scripts`, `marking_imports`, `teacher_aliases`, profile columns, RLS
- `bun add xlsx` for server-side parse
- `src/lib/roles.ts` — `useRole()`, `hasRole`, `isHodOf`, `isSlOf`
- `src/lib/marking.functions.ts` — `importDeploymentXlsx`, `listDeployments`, `updateDeploymentProgress`, `flagScript`, `moderateDeployment`
- `src/routes/_authenticated/oversight.tsx` — dashboard
- `src/routes/_authenticated/oversight.import.tsx` — upload + preview + name-resolution UI
- `src/components/MarkingDeploymentTable.tsx`, `MarkingKPIStrip.tsx`, `TeacherProgressBar.tsx`, `ImportXlsxDialog.tsx`, `NameResolutionPanel.tsx`
- `src/components/AppHeader.tsx` — show "Oversight" nav for HOD/SL
- `src/routes/assessment.$id.tsx` — add "My marking" panel
- `src/routes/admin.users.tsx` (new or extended) — assign role / department / aliases

## What's in vs out for v1

**In:** Roles + departments, paper + deployment tables, XLSX import matching the sample sheet, oversight dashboard, teacher progress entry, basic moderation stamp, header gating.

**Out (later):** Per-script CSV (student-level marks), live SEAB/MIS sync, multi-rater moderation agreement, automated overdue email/Slack reminders, exporting back to XLSX.
