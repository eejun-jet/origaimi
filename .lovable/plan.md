# Pre-generation Assessment Intent Coach

Extend the existing Coach (currently only on the post-generation paper view) into the assessment builder so teachers get sparse, high-leverage guidance **before** the paper is generated.

## Where it appears

In `src/routes/new.tsx`, on steps 2–4:

- Step 2 — Assessment Builder
- Step 3 — Special Instructions
- Step 4 — Generate

(Skipped on Step 1 Basics — nothing meaningful to coach until subject/level/syllabus are picked and sections start to take shape.)

## Layout

Convert the builder page from a single centred 3xl column to a 2-column layout on `lg+` screens:

```text
┌─────────────────────────────────┬──────────────────┐
│  Stepper + step card  (main)    │  Coach sidebar   │
│  Back / Next                    │  (sticky, lg+)   │
└─────────────────────────────────┴──────────────────┘
```

- `lg`: main `max-w-3xl`, sidebar `w-80`, sticky `top-20`.
- `<lg`: sidebar collapses into a small "Coach" button at the top of the step card that opens a `Sheet` (matches the pattern users expect on mobile).
- On Step 1 the sidebar is hidden so the basics page stays as-is.

## Coach behaviour (the prompt the user gave)

The coach must feel like a thoughtful instructional leader — *sparse, contextual, optional*. "Silence is often better than low-value commentary." Concrete rules baked into the UI and prompt:

- At most **1–2 prompts visible at a time**.
- Each prompt is **dismissible** (per session) and **optional** — never blocks Next/Generate.
- No forms, no Bloom jargon, no lecturing. Plain teacher language, British spelling.
- Suggestions are one-liners with an optional "Apply" affordance where it makes sense (e.g. append to Special Instructions).
- If the coach has nothing useful to say, the panel shows a quiet "Looking good — no notes." line, not filler.

## Two interaction modes

1. **Auto-observations** (passive, no AI call needed) — deterministic checks on the current builder state. Cheap, instant, run on every state change. Examples:
  - Step 2: only one question type across all sections → "Mostly MCQ — would one short open-response question add reasoning depth?" (Instructions must NOT contradict the user or syllabus defined specifications, for example, a Paper 1 that is purely MCQ has to be purely MCQ)
  - Step 2: marks don't sum to total → quiet nudge (already shown elsewhere; coach stays silent).
  - Step 2: AOs concentrated on AO1 → "Heavy on recall (AO1). Consider one AO2/AO3 item for application."
  - Step 2: KO/LO coverage very narrow vs picked topics → "Three topics selected, only one is being tested. Is that intentional?"
  - Step 3: empty special instructions on a humanities/science paper → "Want one unfamiliar context question to improve transfer?"
2. **Ask the Coach** (active, one AI call) — a single button "Get Coach review" on Step 4 (and available on 2–3). Sends the current builder state to a new edge function `coach-intent` and returns 2–4 short observations + suggestions in the same panel format.

The Step 4 generate page also surfaces a dim "Run Coach before generating?" hint — optional, one click, never required.

## New edge function: `coach-intent`

`supabase/functions/coach-intent/index.ts`, modelled on `coach-review`:

- Input: `{ subject, level, syllabusCode, paperCode, totalMarks, duration, blueprint (sections), specialInstructions, aoDefs (optional, fetched server-side from syllabus_assessment_objectives like coach-review does) }`.
- Calls Lovable AI (`google/gemini-2.5-flash`) via tool-calling so output is structured:
  ```ts
  submit_intent_review({
    summary: string,           // 1 sentence, optional
    observations: [{ severity: "info"|"warn", note: string, category: "intent"|"ao_balance"|"cognitive_demand"|"coverage"|"context"|"instructions" }],
    suggestions: [{ rewrite: string, rationale: string, target: "instructions"|"sections"|"general" }]
  })
  ```
- System prompt is the exact "Assessment Intent Coach" brief the user supplied (sparse, optional, no jargon, 1–2 high-leverage prompts, etc.). The prompt is in the edge function only — never on the client.
- Same 429 / 402 handling pattern as `coach-review`.
- Not persisted — pre-generation coach runs are ephemeral (no `assessment_versions` row to attach to). Cached in component state for the session.

## New client component: `BuilderCoachPanel`

`src/components/BuilderCoachPanel.tsx`. Props:

```ts
{
  step: 2 | 3 | 4;
  builderState: { subject, level, syllabusCode, paperCode, totalMarks,
                  duration, sections, referenceNote, paperAOs };
  onApplyToInstructions: (text: string) => void;  // append to referenceNote
}
```

Internals:

- Computes auto-observations locally (pure function `computeIntentSignals(builderState)` in `src/lib/intent-coach.ts`).
- Merges them with any AI observations from the last `coach-intent` run.
- Renders at most 2 cards at a time (rest in a "show more" disclosure).
- Each card: severity dot, one-liner, optional "Apply" button (e.g. appends suggestion to Special Instructions for `target: "instructions"`).
- "Get Coach review" button at the top — calls `supabase.functions.invoke("coach-intent", { body: builderState })`. Disabled while running, shows a small `Loader2`.

## Files to change

- **edit** `src/routes/new.tsx` — restructure layout to grid with sidebar slot for steps 2–4; pass builder state and `setReferenceNote` setter into the panel.
- **new** `src/components/BuilderCoachPanel.tsx` — the sidebar UI.
- **new** `src/lib/intent-coach.ts` — pure deterministic checks (no network).
- **new** `supabase/functions/coach-intent/index.ts` — Lovable AI tool-calling edge function with the Intent Coach system prompt.

No DB migrations. No changes to the existing post-generation `CoachPanel` or `coach-review` function.

## Out of scope (deliberately)

- No new tables, no persisted history of pre-gen coach runs.
- No mandatory blocking of "Generate" — the coach is always optional.
- No re-styling of Step 1 Basics.