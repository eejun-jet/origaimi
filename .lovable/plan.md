# Surface saved WA plans on the dashboard

## Background

Every Authentic Assessment (WA) plan is already persisted in `authentic_plans`,
and ideas in `authentic_ideas`. The detail route `/authentic/$id` works
fine — there's just no list anywhere, so once you navigate away the plan
is "lost" unless you remember the URL. The dashboard already lists Paper
sets and Assessments; we add a third section for WA plans alongside them.

## Fix

Edit `src/routes/dashboard.tsx` only. No DB migration. No edge function
changes.

### 1. Load plans

In the dashboard's existing data load, fetch:

```
supabase
  .from("authentic_plans")
  .select("id, title, subject, level, unit_focus, duration_weeks, status, updated_at")
  .order("updated_at", { ascending: false })
  .limit(24);
```

For each plan, also fetch a count of ideas (single grouped query):

```
supabase
  .from("authentic_ideas")
  .select("plan_id, status", { count: "exact", head: false });
```

Aggregate in JS to `{ plan_id → {total, saved} }`. Avoids per-plan round
trips.

### 2. Render a "WA plans" section

Mirror the existing "Paper sets" card visually, with a Lightbulb icon to
match the "Generate WA idea" CTA. Each tile shows:

- Plan title
- Subject · Level · unit focus (if set)
- Idea count: `N ideas · M saved`
- Status pill (`draft` / `published` / etc., reusing existing pill styles)
- Updated relative timestamp

Click navigates to `/authentic/$id`.

Empty state: small muted line "No saved WA plans yet — click Generate WA
idea to start one." Only shown when the user has zero plans (matches the
pattern used for Paper sets).

### 3. Quick delete (optional, low risk)

Add a small trash icon on hover that calls
`supabase.from("authentic_plans").delete().eq("id", id)` after a
confirm dialog. RLS already permits this (`Trial open delete`). Keeps
parity with paper-set tile actions if those exist; if not, skip.

### 4. Header tweak in `/authentic/$id`

Add a "Back to dashboard" Link in the existing header so the round-trip
is obvious. Currently the page has no breadcrumb back.

## Technical details

- Files changed: `src/routes/dashboard.tsx`, `src/routes/authentic.$id.tsx`
  (one-line breadcrumb).
- No types changes (table already in `types.ts`).
- No new dependencies.
- Risk: very low; pure read + presentation work.
