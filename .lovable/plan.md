

## Fix: drop the `auth.users` FK on `assessments` (trial mode)

### Root cause

The app currently runs in **trial mode** (`src/lib/auth-context.tsx`) with a hard-coded demo user `00000000-0000-0000-0000-000000000001`. RLS is permissively open for `public` so most tables accept inserts from this fake user.

But the `assessments` table was created with a strict foreign key:

```
assessments_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
```

Since the demo user does not exist in `auth.users`, **every** assessment insert fails — not just History. (You probably hit it on History first because that's the first time you actually clicked generate.)

None of the other trial-mode tables (`assessment_questions`, `past_papers`, `question_bank_items`, `reference_materials`, etc.) have this FK, which is why they work.

### The fix (one migration)

Drop the FK on `assessments.user_id` so it matches the rest of the trial-mode tables. The column stays `uuid NOT NULL`, just without the referential constraint.

```sql
ALTER TABLE public.assessments
  DROP CONSTRAINT IF EXISTS assessments_user_id_fkey;
```

That's it. No code changes needed — the insert in `generate-assessment/index.ts` already passes the demo user ID, and the open RLS policies already permit it.

### Why this is safe for now

- You're explicitly in trial mode (no real auth, RLS is open to `public`).
- When you later re-enable real authentication, we'll re-add a proper FK as part of that migration alongside restoring tighter RLS policies. That's a larger piece of work and deserves its own plan.

### After approval

I'll run the migration and you can immediately retry "Generate assessment" on History (and any other subject). The FK error will be gone.

