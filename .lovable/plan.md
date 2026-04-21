

## Fix: drop remaining `auth.users` FKs blocking trial-mode inserts

### Why "Generation failed — opening empty draft" happened

Last time I dropped the FK on `assessments` only, but the very next insert (`assessment_questions`) hit the **same** foreign key constraint to `auth.users` and rejected the demo trial user `00000000-…0001`. The assessment row was created, the questions failed, and the UI surfaced this as "Generation failed — opening empty draft".

A direct check against `pg_constraint` shows **five** tables in the trial-mode flow still reference `auth.users(id)`:

| Table | Constraint |
|---|---|
| `assessment_questions` | `assessment_questions_user_id_fkey` ← the one that just failed |
| `assessment_versions` | `assessment_versions_user_id_fkey` ← will fail next when you save a version |
| `question_bank_items` | `question_bank_items_user_id_fkey` ← will fail when you save to question bank |
| `reference_materials` | `reference_materials_user_id_fkey` ← will fail on reference upload |
| `profiles` | `profiles_user_id_fkey` ← keep (only written via auth signup trigger) |

### The fix — one migration, four DROPs

Drop the four FKs that block trial-mode writes. Leave `profiles` alone — it's only written by the `handle_new_user` trigger which fires from real auth signups, so its FK is correct and harmless in trial mode.

```sql
ALTER TABLE public.assessment_questions  DROP CONSTRAINT IF EXISTS assessment_questions_user_id_fkey;
ALTER TABLE public.assessment_versions   DROP CONSTRAINT IF EXISTS assessment_versions_user_id_fkey;
ALTER TABLE public.question_bank_items   DROP CONSTRAINT IF EXISTS question_bank_items_user_id_fkey;
ALTER TABLE public.reference_materials   DROP CONSTRAINT IF EXISTS reference_materials_user_id_fkey;
```

No code changes. RLS stays open as today. Columns stay `uuid NOT NULL`.

### Why this is safe

You're explicitly in trial mode with a hard-coded demo user and permissive RLS. When real auth is reintroduced later, we'll re-add proper FKs and tighten RLS as part of that auth migration — that's a separate, larger piece of work.

### After approval

I'll run the migration and you can immediately retry "Generate assessment" on History, English, Physics, etc. The empty-draft error will be gone, and saving to question bank / saving versions / uploading references will also work without surprises.

