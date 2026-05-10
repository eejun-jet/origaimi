# QA sweep plan

Run an end-to-end check of the app's main features in the live preview, capture any bugs, and report findings. No code changes in this pass — fixes will be a follow-up once issues are confirmed.

## Scope of checks

1. **Auth & shell**
   - `/auth` login / signup loads
   - Header, nav links, signed-in state on `/dashboard`

2. **Dashboard (`/dashboard`)**
   - Lists Assessments, Paper sets, WA plans
   - Search + Subject + Status filters narrow the list
   - Delete buttons appear on hover and confirm before removing
   - Links into `/assessment/$id`, `/paper-set/$id`, `/authentic/$id` open

3. **Create flows**
   - `/new` (new assessment) — form renders, required fields validated
   - `/paper-set/new` — loads, can pick papers
   - `/authentic/new` — WA idea generator loads
   - Skip actually generating with AI unless user wants live AI calls tested (cost + time)

4. **Bank & Papers**
   - `/bank` list and filters
   - `/papers` list and filters

5. **Oversight (`/oversight`)**
   - KPI tile renders (Overdue / Flagged only, after recent change)
   - Filters: Search, Subject, Year, Assessment, Status — confirm all four charts react:
     - Scripts by level
     - Scripts assigned per marker
     - Setting load (horizontal bar with tooltip detail)
   - Marker deployments table updates with filters
   - "Uploaded imports" card stays unfiltered (intended)
   - Sub-pages: `/oversight/import`, `/oversight/points`

6. **Admin**
   - `/admin/syllabus` index + `/admin/syllabus/$id` detail load

7. **Console & network**
   - Watch for runtime errors, failed requests, RLS denials, 401/403/500 across the above

## How

- Use the browser tool to navigate each route at the current viewport, observe key elements, click filters, and screenshot anything broken.
- Read console logs and network requests after each section.
- For destructive actions (delete), only verify the confirm dialog appears — do not actually delete data.
- For AI generation endpoints, only verify the form submits and shows a loading state unless you tell me to run live generations.

## Deliverable

A short report grouped by area: Pass / Issue found (with repro + screenshot) / Skipped (and why). If issues are found, I'll propose targeted fixes in a separate plan.

## Confirm before I start

- OK to run live AI generations during the sweep? (default: no)
- OK to test on whatever data is currently in the account, read-only? (default: yes, no deletes)
