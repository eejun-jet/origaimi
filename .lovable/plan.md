## Goal
Let multiple roles — **peer-setter**, **vetter**, **clearance** (and the original author) — leave threaded comments on a paper, on a section, or on a specific question, with statuses (open / addressed / resolved). Comments become a visible audit trail that justifies the paper's professional quality before finalisation.

## What's there today
- App runs in **free-trial mode** with a single demo user (`src/lib/auth-context.tsx`). There is no real login flow yet.
- The editor (`src/routes/assessment.$id.tsx`) renders an assessment, sections, and `QuestionCard` components — perfect insertion points for comment threads.
- All RLS is currently `true` (open), so a comments table can be added without an auth refactor and tightened later when real auth lands.

## Plan

### 1. Database — `assessment_comments`
Single migration, one new table:
```text
assessment_comments
├─ id              uuid pk
├─ assessment_id   uuid     -- which paper
├─ scope           text     -- 'paper' | 'section' | 'question'
├─ section_letter  text     -- nullable, e.g. 'A'
├─ question_id     uuid     -- nullable, FK-style to assessment_questions.id
├─ parent_id       uuid     -- nullable, for threaded replies
├─ author_name     text     -- e.g. 'Mrs Tan'
├─ author_email    text     -- nullable
├─ author_role     text     -- 'author' | 'peer_setter' | 'vetter' | 'clearance' | 'other'
├─ body            text
├─ status          text     -- 'open' | 'addressed' | 'resolved'
├─ resolved_by     text     -- nullable
├─ resolved_at     timestamptz
├─ created_at      timestamptz default now()
└─ updated_at      timestamptz default now()
```
- Indexes on `(assessment_id)`, `(question_id)`, `(status)`.
- RLS: trial-open (matches the rest of the project) — tighten when real auth is wired.
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE assessment_comments;` so collaborators see new comments live.

### 2. Sharing model
Add a lightweight **share link** so a paper-setter can hand a URL to a vetter without forcing them to sign up:
- `/assessment/$id?as=vetter&name=Mrs%20Lim` — the editor reads `as` and `name` from the URL and uses them as the comment author identity (stored in `localStorage` so they persist on refresh).
- An "Invite reviewer" button in the editor header opens a small modal that builds these URLs for each role with one-click copy. (When real auth lands later, this is swapped for a proper invite/email flow with no UI change.)

### 3. Editor UI — comments everywhere they matter

**A. Comment dock (right-hand sidebar tab)**
A new "Comments" tab next to the AO/KO/LO coverage panel. Shows a filterable feed:
```text
Comments  [3 open · 1 addressed · 8 resolved]
Filter: [All] [Open] [By role ▾] [By section ▾]

● Mrs Tan · vetter · 2h          [Q4 · Section B]
  "Distractor C is too obviously wrong — Year 4 cohort
   will eliminate it instantly."         [Reply] [Mark addressed]
  └─ You · author · 1h
     "Rewritten — please re-check."

○ Dr Lee · clearance · yesterday   [Paper]
  "Total marks (52) doesn't match the cover page (50)."
                                          [Reply] [Resolve]
```

**B. Inline thread on each `QuestionCard`**
- A small badge "💬 2" appears on the card when comments exist (red dot if any are open).
- Clicking expands an inline thread under the card with a textarea: *"Add a comment as **Mrs Lim (vetter)**"*. Each comment shows author + role pill + timestamp + status chip + reply/resolve buttons.

**C. Section-level threads**
- Each section header gets the same affordance (`💬 Add section comment`) for cross-cutting issues ("Section B is heavily AO1 — needs more AO2").

**D. Paper-level thread**
- A dedicated panel at the top of the comments dock for paper-wide remarks.

### 4. Roles & visual distinction
Color-coded role pills so reviewers are instantly recognisable:
```text
author        muted grey
peer_setter   indigo
vetter        amber
clearance     emerald
other         neutral
```
Role is implicit from the share link (`?as=vetter`) but editable in the comment composer dropdown if a reviewer wears multiple hats.

### 5. Realtime updates
Subscribe to `assessment_comments` filtered by `assessment_id` in the editor — new comments, replies, and status changes appear live for everyone viewing the paper. No refresh needed.

### 6. Final-review integration
The "Review & finalise" gate (already on the roadmap) gains one more check:
```text
⚠ 3 open comments from vetters — resolve or override
```
Finalising auto-records the comment summary into `assessment_versions.snapshot` so the audit trail survives.

### 7. Export integration (later, optional)
The DOCX exporter can emit an "Internal review log" appendix listing all resolved/addressed comments per question, useful for clearance documentation. Behind a checkbox in the export dialog so the student-facing paper stays clean.

## Files touched
```
supabase/migrations/<new>.sql                 create assessment_comments + realtime publication
src/integrations/supabase/types.ts            (auto-regenerated)
src/lib/comments.ts                           NEW — types, role colors, share-URL helpers, identity hook
src/components/CommentThread.tsx              NEW — reusable thread (paper / section / question scope)
src/components/CommentDock.tsx                NEW — sidebar feed with filters
src/components/InviteReviewerDialog.tsx       NEW — share-link generator
src/routes/assessment.$id.tsx                 wire dock tab, per-question + per-section threads, header invite button, realtime subscription, identity from ?as / ?name
src/lib/export-docx.ts                        (later, optional) review-log appendix
```

## Result
- Anyone with the share link reviews the paper as their named role — no account creation needed for the trial.
- Comments live at three scopes (paper / section / question) with threaded replies and an open → addressed → resolved lifecycle.
- A live, filterable feed gives the author a single place to triage feedback; inline threads keep context next to the question being discussed.
- Open comments block finalisation by default, so peer-setter / vetter / clearance sign-off becomes visible and enforceable rather than implicit.