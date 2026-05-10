## Problem

In the Coverage tab on past-paper imports, `BlueprintTargetsCard` pre-fills AO targets from each raw sub-code (`A1=40%, A2=40%, A3=20%`) — so the saved overrides and the Δ comparison are at sub-code level, not at the syllabus's actual bucket level (A vs B vs C).

For Combined Science (subject `Sciences`, Sec 4), the syllabus blueprint is **A=50%, B=50%** (the A bucket is theory, B is practical). Today the DB stores only `A1/A2/A3=40/40/20` and `B1..B7` with NULL weights, so the rollup gives A=100% and the coach never flags an under-weighted B bucket.

## What needs to change

### 1. Audit & repair syllabus AO weights (data migration)

Inspect every `(subject, level)` row in `syllabus_assessment_objectives`. Confirm the bucket-level distribution matches the published syllabus, then migrate so each syllabus has one canonical layer that sums to 100 and rolls up cleanly through `bucketTargets`.

Current state (from the DB):

```
Most subjects: AO1/AO2/AO3 codes only — these don't roll up
  (regex requires <single letter><digits>) so the editor already
  shows AO1/AO2/AO3 as bucket rows. Leave alone.

Chemistry Sec 4:  AO1/AO2/AO3 + A1=40, A2=40, A3=20  (duplicate layers)
Physics   Sec 4:  AO1/AO2/AO3 + A1=40, A2=40, A3=20  (duplicate layers)
Sciences  Sec 4:  AO1/AO2/AO3 + A1=40, A2=40, A3=20
                  + A4, A5, B1..B7, C1..C6 with NULL weights
```

Migration:

- **Combined Science (`Sciences` Sec 4)**: set bucket-level weights `A=50, B=50`, clear (set to NULL) all sub-code weights for `A1..A5, B1..B7, C1..C6`. Sub-codes remain as taggable codes; only their `weighting_percent` is removed so the rollup uses the bucket weights.
- **Pure Chemistry / Pure Physics Sec 4**: confirm with user whether the `A1=40, A2=40, A3=20` layer is intentional (a sub-bucket inside AO1) or stray. If stray, delete those three rows so only `AO1=30, AO2=50, AO3=20` remains. (See clarifying question below.)
- **History Sec 4**: deduplicate — each AO is currently inserted twice.
- **All other subjects**: the AO1/AO2/AO3 weights match published syllabi (Bio/Chem/Phys 30/50/20, Geog/Hist/CombHum 30/40/30, Eng/Lit 40/40/20, Maths 35/40/25, GP 30/40/30, Econ 30/40/30). No change.

### 2. `BlueprintTargetsCard` — render at bucket level when sub-codes exist

Today the card renders one row per code returned by `aoDefs ∪ observedAoCodes`. Change it so:

- It groups codes via `bucketOf()` (already exported from `@/lib/ao-rollup`).
- When any sub-code (e.g. `A1`) is observed/declared, the card shows a single editable row for its bucket (`A`) instead of one row per sub-code.
- Pre-fill the bucket's value from `bucketTargets(aoDefs)` so Combined Science shows **A=50, B=50** out of the box.
- The bucket title shows a comma-separated list of contributing sub-code titles (or just the bucket letter when none).
- Saved `ao_overrides` are keyed by bucket letter (e.g. `{A: 50, B: 50}`). The existing consumer `effectiveAoDefs` in `assessment.$id.tsx` already feeds into `bucketTargets`, which treats single-letter `A`/`B` rows as canonical bucket weights and short-circuits the sub-code rollup — so the Coach panel, Coverage panel, and TOS Δ all read the bucket overrides correctly without further changes.
- Subjects whose codes are `AO1/AO2/AO3` keep working unchanged because `bucketOf("AO1") === "AO1"` (regex doesn't match), so each AO stays its own row.

### 3. Verify

- `/assessment/$id` Coverage tab on a Combined Science past-paper import: card shows A=50%, B=50% (editable), TOS Δ uses those.
- `/assessment/$id` Coverage tab on a Geography past-paper import: card still shows AO1/AO2/AO3 as separate rows.
- Coach panel "AO alignment" on the same papers reads the bucket overrides via `effectiveAoDefs → bucketTargets`.

## Clarifying question to confirm before migrating

For **Pure Chemistry Sec 4** and **Pure Physics Sec 4**, the DB has both an `AO1/AO2/AO3 = 30/50/20` layer AND an `A1/A2/A3 = 40/40/20` layer. The Cambridge/MOE pure-science syllabi only define the AO1/AO2/AO3 layer, so the `A1/A2/A3` rows look like leftover seeding. Plan assumes these three rows should be **deleted** for both Pure Chem and Pure Physics Sec 4. If they're meaningful (e.g. paper-specific blueprint), say so and they'll be left alone.

Follow the pure physics and pure chem syllabus document.

## Technical details

- Files touched:
  - `src/components/BlueprintTargetsCard.tsx` — group rows by `bucketOf`, change `values` map keys to bucket letters, persist bucket-keyed overrides.
  - One Supabase migration in `supabase/migrations/` to fix the syllabus rows (Sciences Sec 4 weights, History Sec 4 dedupe, optional Pure Chem/Phys cleanup).
- No changes needed in `intent-coach.ts`, `ao-rollup.ts`, `assessment.$id.tsx`, or the TOS exporters — they already consume bucket-level data via `bucketTargets`.
- No RLS or auth changes.