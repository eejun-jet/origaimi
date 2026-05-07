## Why "Review paper set" looked broken

When you upload ~10 papers at once on `/paper-set/new`, the client loops through every file, uploads to storage, inserts a `past_papers` row, and **fires `parse-paper` per file without awaiting** (`paper-set.new.tsx:161-164`). Each parse call sends the full PDF base64 to Gemini 2.5 Pro via the Lovable AI gateway.

Three failure modes happen, often together:

1. **Connection dropped mid-parse.** The browser kills in-flight invocations on re-render / poll / navigation. `parse-paper` doesn't use `EdgeRuntime.waitUntil`, so the worker shuts down → paper stuck in `processing`. Edge logs confirm: `"Http: connection closed before message completed"`.
2. **Gemini returns no `tool_calls` under concurrent load.** `parse-paper/index.ts:224` immediately marks the paper `failed` with `"AI did not return structured index"` — no retry, no fallback model.
3. **No concurrency throttle, no retry, no UI recovery.** All 10 invocations fire simultaneously; failed papers have no obvious "Retry" button.

Of your last 10 uploads: 5 ready, 3 still `processing`, 2 `failed` with that exact error.

## Fix

### 1. Make `parse-paper` survive client disconnect (`supabase/functions/parse-paper/index.ts`)
- Return `202 Accepted` immediately after marking the paper `processing`, then run the heavy work via `EdgeRuntime.waitUntil(...)`. The browser closing the connection no longer kills the worker.

### 2. Retry transient AI failures inside `parse-paper`
- When `tool_calls` is missing or `aiResp.status` is 429/5xx, retry up to 2 times with exponential backoff (1s, 3s).
- On the final retry, fall back from `google/gemini-2.5-pro` to `google/gemini-2.5-flash` (still tool-calling capable, more lenient under load).
- Only mark the paper `failed` after all retries exhaust; include attempt count + last upstream status in `parse_error` so we can diagnose later.

### 3. Throttle the upload fan-out (`src/routes/paper-set.new.tsx`)
- Replace the unconditional loop with a small concurrency pool (max 3 parses in flight). Upload all files to storage + insert rows fast; gate only the `parse-paper` invocations.
- `await` the invocation (don't fire-and-forget) so the client knows when each parse settled. Combined with `waitUntil` on the server, this stops the connection-drop issue without making the user wait the full duration — the function returns `202` quickly.

### 4. Add a "Retry parsing" affordance
- On `/paper-set/new` and `/papers`, show a small Retry button next to any paper whose `parse_status` is `failed` or has been `processing` for >5 minutes. Clicking it re-invokes `parse-paper` for that single paper.

### 5. Surface clearer status
- In the upload toast, report `Uploaded X · parsing in background. Y already ready.` and update as each finishes.
- In the paper list row, show the actual `parse_error` on hover for `failed` items so you don't have to ask me what went wrong.

## Out of scope (call out, don't do unless you ask)
- Switching the parse pipeline to extract text deterministically with a PDF library before sending to the AI (would cut payload size massively and make Gemini far more reliable, but is a bigger refactor).
- Splitting very large PDFs page-by-page.

## Files touched
- `supabase/functions/parse-paper/index.ts` — `waitUntil`, retry+fallback model.
- `src/routes/paper-set.new.tsx` — concurrency pool, awaited invokes, Retry button, better toast.
- `src/routes/papers.tsx` — Retry button + error tooltip on failed/stuck rows.
