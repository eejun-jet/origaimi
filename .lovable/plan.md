## What happened to "SS Test 2"

The assessment row exists (id `6185080b…`) but is stuck in `status = 'generating'` with **0 questions saved**. Edge function logs show it booted at **03:04:20** and was killed at **03:07:40 — exactly ~200 seconds later**. That's the Supabase edge function wall-clock limit. The worker was force-terminated *before*:
- any question rows were inserted,
- the final `markAssessmentStatus("draft")` call ran,
- the outer `catch` block could set `generation_failed`.

So the row sits forever in "generating" and the UI shows "Loading assessment…" indefinitely.

## Why it timed out

SS / Combined Humanities papers run a heavy per-section pipeline (curated seed → live Tavily text fetches → pictorial image fetch → LLM section build), and the section loop at `index.ts:2008` runs **sequentially** (`for (let si = 0; si < sections.length; si++)`). With 3+ SBQ sections each spending 8s per Tavily call × multiple fetches + image search + LLM, the total stacks past the 200s budget. The recent `contextWriteUp` additions didn't change runtime, but the pipeline was already on the edge.

## Plan

### 1. Unstick the existing row
Migration (one-off SQL): flip `SS Test 2` from `generating` → `generation_failed` so the user can either delete it or retry. (No data to keep — 0 questions.)

### 2. Parallelise the per-section pipeline
`supabase/functions/generate-assessment/index.ts` line ~2008:

- Replace the sequential `for (let si …)` loop with a bounded-concurrency runner (concurrency = 2, since sections share `usedHosts` / `usedUrls` / `sharedSourcePool`-equivalent state — we'll snapshot per section and merge results back deterministically).
- Each section's work returns `{ rows, sectionFailures, droppedNoSource, usedHostsDelta, usedUrlsDelta }`; the merge step is single-threaded.

Expected impact: 3 SBQ sections in ~the time of one → halves the wall clock on combined humanities.

### 3. Hard wall-clock guard around the section phase
Wrap the section phase in a budget (e.g. `SECTION_PHASE_BUDGET_MS = 150_000`, same pattern already used for the diagram phase at line 2738):

- As soon as the deadline passes, stop scheduling new sections and **insert whatever `allRows` we have** + call `markAssessmentStatus("draft_partial")` with a `[generate] section phase budget exhausted` warning.
- This guarantees we *always* reach a terminal status before the worker is killed, even if a Tavily call hangs.

### 4. Tighten the per-fetch timeouts that bloat the loop
- `PER_FETCH_TIMEOUT_MS` (line 2161) is 8s × `FETCH_TARGET` fetches in parallel — fine. But the curated/backfill block + pictorial fetch run *after* and don't share a budget. Add a per-section deadline (~40s) that short-circuits remaining sub-steps once exceeded.

### 5. Client-side: handle `generation_failed` and stuck `generating` cleanly
`src/routes/assessment.$id.tsx`:
- If status is `generation_failed` or `generating` AND `updated_at` is older than 4 minutes, show an inline "Generation timed out — Retry" panel instead of the perpetual "Loading assessment…" spinner.
- Retry invokes the edge function again with the same blueprint payload (already stored on the row).

### Out of scope
- No changes to bundle content, source curation, or the new `contextWriteUp` field.
- No webhook/async architecture rewrite (the stack-overflow-style fix). Parallel + budget should bring well-formed runs under 90s; we revisit async only if that proves insufficient.

## Verification

1. Run the unstick migration → confirm `SS Test 2` row now shows `generation_failed`, retry button appears in UI.
2. Generate a fresh SS Combined Humanities paper end-to-end → completes in <120s, status reaches `draft`, all SBQ sections have the `[CONTEXT]…[/CONTEXT]` write-up.
3. Force a slow path (e.g. set `PER_FETCH_TIMEOUT_MS=20000` locally) and confirm the section-phase budget kicks in, partial rows are inserted, status is `draft_partial`, no stuck `generating`.
4. Inspect edge logs for the new `[generate] section phase budget exhausted` warning when triggered.
