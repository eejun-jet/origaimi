## Why papers get stuck

`parse-paper` does too much in one Edge invocation. After Gemini extracts the question index, it loops sequentially through every detected figure and calls `gemini-3-pro-image-preview` (15–40s per figure) to re-render it. A typical question paper has 8–15 figures → 3–8+ minutes of work, which exceeds the Edge wall-clock cap. The worker is killed mid-loop, so the row stays `processing` forever with no `parse_error`. File size is irrelevant — figure count is what kills it. (Confirmed: stuck rows are all `[QP]` papers; `[MS]` mark schemes with few figures all completed.)

## Fix

### 1. Mark paper `ready` as soon as the index is extracted
File: `supabase/functions/parse-paper/index.ts`

- Remove the inline `renderAndUploadFigure` loop from `runParse`.
- Insert `past_paper_diagrams` rows up front with `image_path` pointing to the source PDF (`papers/${filePath}`) so coverage and diagram references still work.
- Write `questions_json`, `style_summary`, classifications, bank rows, fingerprint, then flip `parse_status='ready'` immediately.
- Cap `figures` at 30 to bound work.
- Wrap `classifyQuestions` in a 30s timeout via `Promise.race`; on timeout, proceed with empty classifications instead of failing the whole parse.
- After marking ready, kick off the new `render-paper-figures` function via `EdgeRuntime.waitUntil(supabase.functions.invoke("render-paper-figures", { body: { paperId } }))`.

### 2. New edge function `render-paper-figures`
File: `supabase/functions/render-paper-figures/index.ts` (new)

- Accepts `{ paperId }`. Returns 202 immediately, does work via `EdgeRuntime.waitUntil`.
- Loads `past_paper_diagrams` rows for the paper where `image_path LIKE 'papers/%'` (i.e. unrendered).
- Concurrency pool of 3, per-figure timeout 25s (`Promise.race` with abort). On success, update the row's `image_path` to the new `diagrams/...` key. On timeout/error, leave `image_path` untouched — can be retried later.
- Idempotent and re-runnable.

### 3. Watchdog cron for stuck rows
File: `src/routes/api/public/cron/sweep-stuck-papers.ts` (new)

- POST handler. Updates any `past_papers` row where `parse_status='processing'` AND `updated_at < now() - interval '5 minutes'` to `parse_status='failed'`, `parse_error='Worker died during parsing — likely timeout. Click Retry.'`
- Uses `supabaseAdmin`.
- Schedule via `pg_cron` + `pg_net` to call this endpoint every 2 minutes (using anon key in `apikey` header).

### 4. UI: "diagrams rendering" affordance
Files: `src/routes/paper-set.new.tsx`, `src/routes/papers.tsx`

- For papers with `parse_status='ready'` but any diagram rows still pointing at `papers/%`, show a small "diagrams pending" badge and a "Re-render diagrams" button that invokes `render-paper-figures`.
- Doesn't block the user from creating the set.

### 5. Cleanup currently-stuck rows
Run a one-shot UPDATE flipping the 3 rows currently `processing` for >15 min to `failed` so the existing Retry button becomes reachable.

## Files touched

- `supabase/functions/parse-paper/index.ts` — strip inline figure render, mark ready earlier, cap figures, classifier timeout, kick off render-paper-figures
- `supabase/functions/render-paper-figures/index.ts` — new, pooled time-bounded renders
- `src/routes/api/public/cron/sweep-stuck-papers.ts` — new watchdog endpoint
- migration: enable `pg_cron`/`pg_net` (if needed) and schedule sweep
- one-shot UPDATE for currently stuck rows
- `src/routes/paper-set.new.tsx`, `src/routes/papers.tsx` — "diagrams pending" badge + re-render button
