# Peg paper difficulty to specimen papers

Currently, specimen papers influence generation only as free-text exemplars dropped into the prompt. The model is told to "match difficulty norms" but nothing measures whether it actually did. This plan closes that loop in two places.

## What changes for the user

1. **Difficulty mix auto-suggested from the specimen** — when you start a new assessment for a subject + level that has a parsed Cambridge/MOE specimen, the Builder pre-fills the easy/medium/hard mix per section to mirror the specimen instead of a flat default.
2. **New "Calibration vs specimen" Coach check** — after generation, the Coach compares the new paper's difficulty fingerprint (Bloom mix, AO mark share, marks-per-question shape, command-word register) against the specimen and flags drift.

If no specimen is parsed for the subject + level, both features quietly no-op — no regressions.

## Technical changes

### 1. Specimen fingerprint at parse time

Add column:

```sql
ALTER TABLE public.past_papers
  ADD COLUMN difficulty_fingerprint jsonb;
```

Fingerprint shape (computed in `parse-paper/index.ts` from `questions_json` after the AI returns):

```json
{
  "version": 1,
  "is_specimen": true,
  "total_marks": 80,
  "question_count": 12,
  "marks_per_question": { "min": 2, "median": 6, "max": 12, "histogram": {"1-3": 4, "4-6": 5, "7-12": 3} },
  "command_word_freq": { "explain": 4, "compare": 2, "calculate": 3, "describe": 2, "evaluate": 1 },
  "bloom_mix_pct": { "remember": 10, "understand": 25, "apply": 35, "analyse": 20, "evaluate": 10 },
  "ao_mark_share_pct": { "AO1": 30, "AO2": 50, "AO3": 20 },
  "sub_part_depth_avg": 2.4
}
```

Bloom + AO are inferred from command-word + marks heuristics shared with `coverage-infer.ts`. `is_specimen` reuses the same regex check `exemplars.ts` already uses (title/notes/paper_number contains "specimen|sample|exemplar").

### 2. Auto-suggested difficulty mix in Builder

`src/routes/new.tsx` — when subject + level change, query `past_papers` for the most recent `is_specimen=true` row and read `difficulty_fingerprint.bloom_mix_pct`. Collapse Bloom 6 categories into easy/medium/hard:

- easy = remember + understand
- medium = apply + analyse
- hard = evaluate + create

Pre-fill each section's `difficulty_mix` with that mapping. User can still override. A small chip "Calibrated to <specimen title>" appears next to the mix slider.

### 3. Coach calibration check

Edge function `coach-review/index.ts`:

- Add a deterministic pre-step (no AI cost): load the specimen fingerprint for the assessment's subject + level + paper number, compute the same fingerprint over the generated paper, diff each metric.
- New finding category `calibration` added to `CoachFindings`:

```ts
calibration: {
  has_specimen: boolean;
  specimen_title?: string;
  bloom_drift: { level: string; specimen_pct: number; observed_pct: number; delta: number }[];
  ao_drift: { ao: string; specimen_pct: number; observed_pct: number; delta: number }[];
  marks_shape_drift: { metric: "median"|"max"|"avg_subparts"; specimen: number; observed: number; severity: Severity }[];
  command_word_gaps: string[]; // command words common in specimen but missing here
  severity: Severity;
  note: string;
}
```

Severity rules: drift > 8pp → warn, > 15pp → fail (matching existing AO drift thresholds). The AI tool schema is unchanged for this section because the diff is computed locally — only `summary` and `suggestions` still come from the AI, and the calibration findings are merged into the response after the AI call.

Frontend `src/routes/assessment.$id.tsx`:

- Add a new `<CoachSection title="Calibration vs specimen">` rendering the diff as small comparison rows (specimen % vs observed %, with the same fail/warn chips used for AO drift).
- If `has_specimen=false`, render a one-line muted note "No specimen parsed for this subject + level — upload one in Papers to enable calibration."

### 4. Backfill

For papers already parsed, add a one-shot backfill at the top of the migration that recomputes the fingerprint inline using the existing `questions_json`. New papers compute it during parse. No re-parse needed.

## Files touched

- `supabase/migrations/<new>.sql` — add column + backfill
- `supabase/functions/parse-paper/index.ts` — write fingerprint
- `supabase/functions/parse-paper/fingerprint.ts` — new shared helper (re-used by Coach)
- `supabase/functions/coach-review/index.ts` — load specimen, compute observed, diff, merge into findings
- `supabase/functions/coach-review/fingerprint.ts` — symlink/copy of the shared helper (edge functions don't share imports across folders)
- `src/routes/new.tsx` — auto-suggest difficulty mix
- `src/routes/assessment.$id.tsx` — render new Calibration section
- `src/integrations/supabase/types.ts` — auto-regenerated

## Out of scope

- Per-question pegging (e.g. forcing question 3 to match specimen Q3). Too brittle and pedagogically wrong.
- Self-grading pass where the AI re-rates its own difficulty — separate, more expensive feature; revisit only if the calibration check shows persistent drift.
