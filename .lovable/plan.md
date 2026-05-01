## Goal

Bring the existing post-generation Assessment Coach (`coach-review` edge function + the Coach panel inside `assessment.$id.tsx`) in line with your "Assessment Review Coach" spec. The current pipeline already does the structural heavy-lifting (AO drift, KO/LO realisation, source-fit, mark-scheme realism, suggestions, and specimen calibration). What's missing is the *voice*, the *prioritisation*, and a few analytical lenses your spec calls out explicitly.

The plan is small and focused: revise the system prompt, extend the tool schema with two lightweight lenses, add a top-level `priority_insights` array, and lightly retune the UI so the headline insight reads first and reads calm.

---

## What changes

### 1. Rewrite the system prompt (`supabase/functions/coach-review/index.ts`)

Replace the current "Assessment Literacy Coach" preamble with a prompt that adopts your spec verbatim in spirit:

- **Identity**: "Assessment Review Coach. You are reviewing the assessment, not the teacher."
- **Tone rules** baked in as hard constraints:
  - No praise language ("great", "excellent", "fantastic", "well done").
  - No verdicts ("weak", "lacks rigour", "not rigorous").
  - Calm, quietly competent, British spelling, Singapore phrasing.
  - One excellent insight beats ten average ones — if a check has nothing material, return an empty array rather than padding.
- **Prioritisation rule**: rank findings by impact on the *teacher's next decision*, not by check order. Surface the top 1–3 as `priority_insights`.
- **Syllabus-as-philosophy layer**: when AO definitions are present, treat them as a cognitive framework, not a checklist. Infer command-term expectations and reasoning balance; don't quote syllabus prose.
- **Phrasing exemplars** seeded directly from your spec ("Most questions currently assess direct retrieval", "Adding one unfamiliar application task may better distinguish stronger students").

### 2. Extend the tool schema with two lenses your spec names explicitly

Today's schema covers AO drift, KO/LO realisation, source-fit, mark-scheme, and suggestions. Add:

- **`cognitive_demand`** — one short observation on the recall/application/analysis spread, with a single optional nudge. Replaces the current implicit hand-waving inside `suggestions`.
- **`question_variety`** — one short observation on command-verb diversity, item-format mix, and reading load (e.g. "Six of eight stems exceed 80 words; consider one short-form item to vary load"). Optional.

Both are **single-object, optional fields** — not arrays — to enforce "one excellent insight" rather than a giant report. Each has `{ severity, note, suggestion? }`.

Also add a top-level **`priority_insights: string[]`** (max 3) — the calm headline the panel renders first.

### 3. Tone-guard the existing `summary`

Keep `summary` but tighten the contract: "2 sentences max, neutral, observation-led, no praise, no verdicts." This pairs with `priority_insights` so the panel can lead with insight, not with a generic recap.

### 4. UI: lead with priority insights, soften visual weight (`src/routes/assessment.$id.tsx`)

Small, surgical changes inside the existing Coach panel:

- Render `priority_insights` (if present) as a short bulleted block above the `summary` — same calm card styling as today, no new colours.
- Add two new collapsible sections — "Cognitive demand" and "Question variety" — using the existing `FindingSection` pattern. They appear only when populated.
- Update the `CoachFindings` TypeScript type to match the extended schema.
- No layout, colour, or routing changes. No new dependencies.

### 5. Leave alone

- `intent-coach.ts` and `BuilderCoachPanel.tsx` (pre-generation coach) — different prompt, different lifecycle, already aligned.
- The fingerprint/calibration code path — it's already deterministic and on-tone.
- The persistence model (`assessment_versions` snapshot) — extra fields are additive and JSON-safe.

---

## Files touched

- `supabase/functions/coach-review/index.ts` — new system prompt, extended tool schema (`cognitive_demand`, `question_variety`, `priority_insights`).
- `src/routes/assessment.$id.tsx` — extend `CoachFindings` type; render `priority_insights` and the two new sections in the Coach panel.

## Files NOT touched

- `src/lib/intent-coach.ts`
- `src/components/BuilderCoachPanel.tsx`
- `supabase/functions/coach-intent/index.ts`
- `supabase/functions/coach-review/fingerprint.ts` and `coverage-infer.ts`
- DB schema — none required.

---

## Why this is the right shape

Your spec's biggest delta vs what we ship today isn't the *checks* — those are mostly there. It's three things:

1. **Prioritisation** — teachers see whatever the model emits in check-order. Adding `priority_insights` forces the model to pick what matters and lets the UI lead with it.
2. **Tone** — the current prompt says "candid but constructive"; your spec is stricter ("calm and quietly competent, no AI enthusiasm"). The new prompt encodes that as hard rules with explicit anti-patterns.
3. **Lenses your spec names but we don't surface** — cognitive demand spread and question variety / reading load. Adding them as optional single observations (not arrays) keeps the panel from turning into the "giant report" your spec warns against.

No infra change, no migrations, no new dependencies. Behaviour change is concentrated in the prompt and a handful of UI lines.