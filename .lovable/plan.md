## Why "Review" looks like a refresh

In TanStack Router, when a file like `src/routes/admin.syllabus.$id.tsx` exists alongside `src/routes/admin.syllabus.tsx`, the latter automatically becomes a **parent layout** for the former. A parent layout MUST render `<Outlet />` for the child route to appear.

`src/routes/admin.syllabus.tsx` does not render `<Outlet />` — it returns a self-contained list view. So when you click Review:

- The URL silently changes to `/admin/syllabus/<id>` (you can confirm this in the address bar).
- TanStack Router activates the child route in memory…
- …but the parent keeps rendering the upload form + library list, so the child screen is never shown.

That is exactly the "nothing happens / page just refreshes" symptom.

There is also a secondary issue surfaced by the database: one syllabus (`Combined Science 5086`) is stuck in `parse_status = 'parsing'` (the parser was killed mid-run, likely by the earlier "AI error 402 Not enough credits" / "connection closed" entries in the edge logs). It has no papers/topics, so even once Review works it will look empty for that doc.

## Changes

### 1. Fix the routing — split the list page out from the layout

Rename `src/routes/admin.syllabus.tsx` → `src/routes/admin.syllabus.index.tsx`. In flat-file routing, `admin.syllabus.index.tsx` claims exactly the path `/admin/syllabus`, while `admin.syllabus.$id.tsx` claims `/admin/syllabus/$id` — neither becomes the other's parent, so no `<Outlet />` is needed and the child review page renders normally.

(Alternative considered: keep the file and add `<Outlet />` plus a conditional that renders the list only when no `$id` is present. Cleaner to split.)

### 2. Make the Review screen visually distinct

In `src/routes/admin.syllabus.$id.tsx`:

- Add a clearer page heading under the sticky bar: "Review & publish syllabus" with a subtitle line explaining what this screen is for ("Edit parsed papers, topics, and assessment objectives, then Publish to make this syllabus available to the assessment coach").
- When `papers.length === 0 && topics.length === 0`, render an explicit empty state card: "No papers or topics were extracted. Re-parse from the library, or check that the uploaded PDF is text-based (not a scanned image)." with a "Back to library" button.
- When `parse_status === 'parsing'`, show a yellow info banner: "Parsing in progress — refresh in a minute. If it stays in this state, the parser likely failed mid-run; re-parse from the library."

### 3. Recover the stuck "parsing" doc

Add a small safety net to `src/routes/admin.syllabus.tsx` (the list page, soon `admin.syllabus.index.tsx`):

- A "Reset to pending" action on rows whose status is `parsing` and whose `updated_at` is older than ~5 minutes. This flips the row back to `pending` so the user can click Re-parse cleanly. (Pure UI + a single update query — no schema change.)

Plus a one-time DB update (via migration) to flip the currently stuck `Combined Science 5086` row from `parsing` → `pending` so the user can immediately re-parse it.

### 4. Diagnose why some parses produce nothing

For the syllabi already in `parse_status = 'parsed'` but the user still feels there's "nothing to review", check via SQL once the routing fix is in: count papers / topics / AOs per doc. If a parsed doc has zero topics, it usually means the AI extraction hit a token cap or the PDF pages were image-only. The empty-state card from step 2 will surface that clearly to the user, with a Re-parse path.

No changes to the parser itself in this round — once the user can actually open the Review screen, we'll know whether parsing quality is the next thing to tackle.

## Files to change

- Rename `src/routes/admin.syllabus.tsx` → `src/routes/admin.syllabus.index.tsx` (no logic change beyond filename + add the "Reset to pending" row action).
- Edit `src/routes/admin.syllabus.$id.tsx` — add page heading, empty state, and "parsing" banner.
- New migration: `UPDATE syllabus_documents SET parse_status='pending' WHERE id='c5c857bf-c95b-4d43-b317-4589f872c77b' AND parse_status='parsing';`

## What you'll see after this

- Clicking Review actually opens the review screen with metadata, papers, topics, AOs, Save, and Publish.
- Docs that parsed cleanly show their content; docs that produced nothing show a clear "no content extracted" card instead of a confusingly empty page.
- The stuck `5086` syllabus becomes re-parsable from the library.
