# Coach Chat — conversational mode for the Assessment Coach

Right now the Coach panel does a one-shot review: click "Ask Coach" → it returns 1–3 observations + suggestions. There's no way to ask a follow-up like *"What's a good way to push this from recall to application?"* or *"Give me a Singapore context idea for the SBQ."*

We'll add a **Chat** tab inside the existing `BuilderCoachPanel` so the same panel does both: the structured review (current behaviour) **and** a free-form conversation grounded in the live builder snapshot.

## Where it lives

- Same panel as today (`src/components/BuilderCoachPanel.tsx`), already shown on Steps 2–4 of the builder and on the assessment view post-generation.
- A small two-tab toggle at the top: **Review** (current) | **Chat** (new).
- On the post-generation page (`src/routes/assessment.$id.tsx`), we'll mount the same panel in "post-gen" mode so teachers can also chat about the draft they just got.

## What the chat does

- Conversational, grounded in the **same builder snapshot** the Review tab already sends (subject, level, AOs, KOs/LOs, sections, special instructions, syllabus aims/rationale where available).
- Teacher can:
  - Ask open questions ("Is AO1 too heavy here?", "What's a good unfamiliar context for this topic?")
  - Brainstorm ideas ("Give me 3 SBQ source-pair ideas for Cold War").
  - **Apply** any teacher-friendly one-liner the bot offers straight to **Special Instructions** with one click (same affordance as today's suggestions).
- Streams tokens for a snappy feel.
- Stays in the Coach voice: sparse, plain teacher language, British spelling, no Bloom's jargon, never lectures, never invents syllabus codes.
- Conversation lives in component state for the session — not persisted (matches the lightweight, optional spirit of the Coach). A small "Clear chat" link resets it.

## New backend: `coach-chat` edge function

A new function `supabase/functions/coach-chat/index.ts` that:

- Accepts `{ snapshot, messages, stage: "pre" | "post", assessmentId? }`.
- Loads syllabus context (aims, assessment rationale, pedagogical notes, command-word glossary) the same way `coach-intent` already does, when `syllabus_doc_id` is present.
- When `stage === "post"` and `assessmentId` is provided, also pulls the generated paper summary (sections, question stems, AO/LO tags) so the bot can reason about the actual draft, not just the plan.
- Calls Lovable AI Gateway (`google/gemini-3-flash-preview`) with `stream: true` and returns the SSE stream straight to the client (per Lovable AI streaming pattern).
- System prompt extends the existing Coach brief with chat-specific rules:
  - Keep replies short (≤4 short paragraphs or ≤6 bullets).
  - When the teacher asks for an idea, give 2–3 options, not a lecture.
  - When proposing something the teacher could drop into Special Instructions, wrap it in a fenced block tagged `instruction` so the UI can render an "Apply to instructions" button next to it.
  - Never claim to have generated the paper / never re-do the Review's job.
  - Refuse off-topic requests politely (one line) and steer back to assessment design.
- Handles 429/402 cleanly and surfaces them to the client as toasts (same pattern as `coach-intent`).

## Frontend changes

### `src/components/BuilderCoachPanel.tsx`
- Add a tab switcher (Review | Chat) using existing `Tabs` UI.
- New `CoachChat` subcomponent:
  - Local `messages: {role, content}[]` state.
  - Composer (textarea + send button + Enter-to-send, Shift+Enter newline).
  - Streams via `fetch` to `/functions/v1/coach-chat` and appends tokens to the last assistant message (token-by-token SSE parse, per Lovable AI streaming guidance).
  - Renders assistant messages with `react-markdown` (already installed) so lists/bold come through.
  - When the assistant emits a fenced `instruction` block, render an inline "Apply to instructions" button that calls the existing `onAppendInstructions` prop — so the chat reuses the same plumbing as the Review tab.
  - Empty state: 3 suggestion chips ("Is the AO mix balanced?", "Give me a transfer context for this topic", "How can I push this beyond recall?") that prefill the composer.
  - "Clear chat" link in the panel header when chat has any history.
- Keep the existing Review behaviour identical when the Review tab is active.

### `src/routes/new.tsx`
- No structural changes — `BuilderCoachPanel` already receives the snapshot and `onAppendInstructions`. Chat inherits both for free.

### `src/routes/assessment.$id.tsx` (post-generation)
- Mount `<BuilderCoachPanel>` in a sidebar/drawer with `stage="post"` and the generated paper id, so teachers can chat about the draft (e.g. "Question 4 feels easy — suggest a harder variant" → bot replies, teacher can copy ideas back into the regenerate flow). No auto-apply here; chat output is advisory.

## Out of scope (intentionally)

- No persistence of chat history across sessions — keeps the feature lightweight and matches Coach's "optional, low-stakes" voice. We can add it later if teachers ask.
- No tool-calling that mutates the builder state directly. The only write affordance is the existing "Apply to instructions" button.
- No "ask Coach to generate the paper" — generation stays on the Generate button. Chat is for thinking, not for shortcutting the pipeline.

## Technical notes

```
POST /functions/v1/coach-chat
{
  stage: "pre" | "post",
  snapshot: { ...same shape as snapshotForAI() },
  assessment_id?: string,        // post-gen only
  messages: [{ role: "user"|"assistant", content: string }, ...]
}
→ text/event-stream (OpenAI-compatible SSE chunks)
```

- Function uses `google/gemini-3-flash-preview` for low latency. Falls back to a friendly toast on 429/402.
- The system prompt is composed from the existing `coach-intent` brief + a small chat-mode addendum, so tone stays consistent across Review and Chat.
- Markdown rendering: `react-markdown` (used elsewhere in the project) with a custom renderer for fenced ```instruction blocks that swaps in an "Apply" button.
- `supabase/config.toml`: add a `[functions.coach-chat]` block only if non-default settings are needed (likely just `verify_jwt = true` to require an authed teacher); otherwise rely on defaults.

## Files touched

- **new** `supabase/functions/coach-chat/index.ts`
- **edit** `src/components/BuilderCoachPanel.tsx` — add Tabs + CoachChat subcomponent
- **edit** `src/routes/assessment.$id.tsx` — mount panel post-generation in `stage="post"` mode
- **edit (maybe)** `supabase/config.toml` — register the new function if it needs non-default settings

After approval I'll implement, deploy `coach-chat`, and verify streaming + the "Apply to instructions" hand-off in both pre- and post-generation contexts.