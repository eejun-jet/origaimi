# Fix WA "Refine idea → Apply" silently reverting

## What's actually happening

Clicking **Apply** calls `refine-authentic-idea`. The function uses an AI tool
schema (`submit_idea`) with the same shape that previously broke
`generate-authentic-ideas`: deep nested rubric (`array<{criterion, levels:
array<{label, descriptor}>}>` with `required` and `additionalProperties:
false` everywhere). On the AI gateway this can return a 400 *"specified
schema produces a constraint that has too many states for serving"*, which
the function turns into a generic 502 *"Refine failed"*. The client toast
fires but the UI doesn't change → it looks like a revert.

A second, separate problem: the schema has **no field** for the things the
teacher is actually asking for — a student worksheet/scaffold and a session
timeline. The DB row already has a `milestones jsonb` column that nothing
in the refine flow writes to, and there is no `worksheet` field at all.
Even when the schema *does* accept the call, the model has nowhere to put
the requested content, so it can only stuff it into `student_brief` or
`teacher_notes` — easy to miss.

## Fix

Edit `supabase/functions/refine-authentic-idea/index.ts` and the idea
detail UI in `src/routes/authentic.$id.tsx`. No DB migration needed —
`milestones` already exists; we add a `worksheet` field by reusing
`teacher_notes` + a structured `milestones` array.

### 1. Simplify the tool schema (same fix as generate-authentic-ideas)

- Drop `additionalProperties: false` everywhere.
- Flatten rubric levels to `levels: { type: "array", items: { type: "string" } }`
  (a list of "Level — descriptor" strings). The UI already handles this
  shape after the earlier `Rubric` flattening change.
- Reduce `required` to just `title`, `brief`.
- Remove deep nesting on milestones (use `array<{label, duration_minutes,
  description}>`).

### 2. Add fields that match the teacher's request

Add to `submit_idea`:
- `milestones`: array of `{ label, duration_minutes, description }` — for
  the 3×1-hour timeline.
- `student_worksheet`: long string — the scaffold/preparation questions
  the teacher asked for (markdown, free-form). Persisted into the existing
  `teacher_notes` column under a clear `## Student worksheet` heading
  appended to whatever else the model puts there, OR (preferred) into a
  new `student_brief` section. We keep DB writes to existing columns only.

Mapping on save:
- `milestones` → `authentic_ideas.milestones` (already a jsonb column).
- `student_worksheet` → appended to `student_brief` under a `## Worksheet
  / Scaffold` heading so it shows in the existing student-facing panel.
- Everything else maps as today.

### 3. JSON-mode fallback

If the tool call returns no arguments OR the gateway responds 400/502, retry
once with `response_format: { type: "json_object" }` and a system message
that asks for a JSON object matching the same field names. Same pattern we
used in `generate-authentic-ideas`.

### 4. Surface real errors, don't silently revert

In the edge function: bubble the upstream gateway error body (truncated to
~300 chars) in the JSON error response instead of a flat
"Refine failed". In `authentic.$id.tsx` `refine()`:
- Read `data?.error` from the function response and show it in the toast.
- On error, **do NOT clear the instruction textarea** so the teacher can
  retry/edit without retyping their whole brief. (Today, the field is
  cleared on error too because `setInstruction("")` is called even when
  the catch fires for some error paths — verify and gate behind success.)

### 5. Render new fields in the detail drawer

In `IdeaDetail`:
- New "Timeline" section listing `milestones` (label, duration, description)
  if present.
- The worksheet content arrives inside `student_brief`, so it renders in
  the existing student brief block — no UI change needed there beyond
  ensuring markdown line breaks render (use `whitespace-pre-wrap`).

## Technical details

- Files changed: `supabase/functions/refine-authentic-idea/index.ts`,
  `src/routes/authentic.$id.tsx`.
- Functions to redeploy: `refine-authentic-idea`.
- DB: no migration. `milestones` column already exists on
  `authentic_ideas`.
- Risk: low. Schema simplification has been validated for the same model
  in `generate-authentic-ideas`. JSON fallback covers the edge case.

## What this does NOT change

- Idea generation, KO/LO alignment picker, or any other WA flow.
- The `Rubric` type or rubric persistence.
