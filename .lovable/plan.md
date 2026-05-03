## Goal

For multi-discipline subjects (Combined Science = Physics + Chemistry + Biology, Combined Humanities, etc.), stop flagging the untested discipline as "Untested". If a paper / paper-set only covers two sciences, the third should drop out of the AO / KO / LO coverage analysis and the Assessment Coach entirely — it isn't in scope.

## Approach

Auto-detect "in-scope disciplines" from the actual question tags, then filter every coverage rollup, topic map and coach payload to that scope. Surface the detected scope in the UI with a small toggle so the teacher can override (e.g. include a discipline that has zero questions yet because they're still building).

### 1. Detect in-scope disciplines (`src/lib/coverage-infer.ts` — new helper)

```ts
// Reuse the same normaliseDiscipline() logic already in assessment.$id.tsx.
export function inferInScopeDisciplines(args: {
  questions: { topic?: string|null; knowledge_outcomes?: string[]; learning_outcomes?: string[] }[];
  syllabusTopics: { section: string|null; title: string; ... }[];
  // Optional teacher override stored on assessment / paper_set
  override?: string[] | null;
}): Set<string>  // e.g. {"Physics","Chemistry"}
```

Rule of inclusion (only applied when ≥2 disciplines exist in the syllabus pool):
- A discipline is "in scope" if at least one question is tagged with a KO/LO/topic that belongs to it; OR
- the teacher has explicitly ticked it in the override.

If only one discipline is found in the syllabus (e.g. pure Biology paper), skip filtering — nothing changes for single-subject papers.

### 2. Filter coverage in `assessment.$id.tsx`

In `buildCoverage(...)` (around L1862–1948), once `inScope` is known:
- Drop AO codes that only belong to out-of-scope disciplines (AOs are usually shared, so this is rare; keep the AO if any in-scope topic uses it).
- Drop KOs whose owning discipline is out of scope (`KO → discipline` derived from the syllabus topic that contains it).
- Drop LOs the same way.
- In `buildTopicsMap`, simply skip disciplines not in `inScope`.

Effect: the Coverage Explorer's "By LO / By KO / By topic" panes no longer show Biology rows when the paper is Physics + Chemistry only, and the donut totals adjust accordingly.

### 3. Apply same filter to the paper-set view (`src/routes/paper-set.$id.tsx`)

The aggregated KO / LO / "Unrealised" lists already iterate `syllabus_topics`. Filter that list by `inScope` derived from the union of all paper questions in the set before computing `unrealisedKOs` / `unrealisedLOs` and the per-paper grid.

### 4. Coach payload — exclude out-of-scope disciplines

`coach-review` and `paper-set-review` edge functions already receive a `unrealised_outcomes` block. Trim that list to `inScope` disciplines before sending so the AI cannot flag "Biology not covered" when Biology is out of scope. Also append a one-line note to the system prompt:

> "The teacher has scoped this assessment to {Physics, Chemistry}. Treat any other discipline (e.g. Biology) as out of scope — never recommend adding coverage for it."

### 5. UI: show scope + allow override

On both `assessment.$id.tsx` (Coverage Explorer header) and `paper-set.$id.tsx` (above the tabs), render a compact strip:

```
Scope:  [✓ Physics]  [✓ Chemistry]  [ ] Biology   (auto-detected — click to override)
```

- Clicking a chip toggles it; the override is persisted in `assessments.blueprint.scoped_disciplines` (existing jsonb column, no migration) or `paper_sets.notes`-style field — proposing a new column `scoped_disciplines text[]` on both `assessments` and `paper_sets` via migration.
- A subtle "Reset to auto-detected" link clears the override.

### 6. Migration

```sql
alter table public.assessments add column if not exists scoped_disciplines text[];
alter table public.paper_sets   add column if not exists scoped_disciplines text[];
```

No RLS changes — both tables already have trial-open policies.

## Out of scope for this change

- Renaming "Untested" labels — once the discipline is filtered out the label only fires on genuinely-missing topics within the in-scope sciences, which is the correct behaviour.
- Changing how the parser tags questions in the first place; this is a presentation / aggregation filter only.

## Files touched

- `src/lib/coverage-infer.ts` — add `inferInScopeDisciplines` + KO/LO → discipline lookup
- `src/routes/assessment.$id.tsx` — filter `buildCoverage` and `buildTopicsMap`, render scope chips
- `src/routes/paper-set.$id.tsx` — same filter + scope chips on the macro view
- `supabase/functions/coach-review/index.ts` — trim payload + system-prompt note
- `supabase/functions/paper-set-review/index.ts` — same
- `supabase/migrations/<new>.sql` — add `scoped_disciplines` to `assessments` + `paper_sets`
