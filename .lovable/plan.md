# Upload-a-paper into the Assessment Builder

## What the teacher gets

A new "Upload existing paper" path on Step 1 of New Assessment. They drop a PDF (complete or partial), pick subject/level/syllabus paper, and we:

1. Store the PDF in the `papers` bucket and create a `past_papers` row.
2. Run the existing `parse-paper` edge function (extracts questions, sub-parts, diagrams, AO/KO/LO tags, command words).
3. Convert the parsed result into an `assessments` row + `assessment_questions` rows via the existing `analysePastPaper` helper — this is the same path `/papers` already uses.
4. Drop the teacher straight onto `/assessment/$id`, where they can:
   - Edit / add / delete / regenerate questions in place (already supported).
   - See the auto-built TOS, AO/KO/LO coverage panel, and the Coach review tab (already supported for `assessment_type = "past_paper_analysis"`).
   - Run "Refresh LO coverage" and "Coach review" (already wired).

Incomplete papers are fine — `analysePastPaper` already tolerates 0-mark or stub questions, and the editor lets them top up.

## Where it goes in the UI

Step 1 of `src/routes/new.tsx` gets a top-of-page mode toggle:

```text
How do you want to start?
  ( ) Build from scratch         ( ) Upload an existing paper
```

- "Build from scratch" → current Step 1 form, unchanged.
- "Upload an existing paper" → compact upload card (Title, Subject, Level, Year, Paper number, Exam board, PDF) + "Upload & analyse" button. Subject/Level/Syllabus paper picker is reused from the existing Step 1 so the analysed assessment is wired to the right syllabus doc/paper.

On submit we run the same flow `src/routes/papers.tsx` already uses, then `navigate({ to: "/assessment/$id" })` once parsing + analysis finish. While the edge function parses we show a progress card ("Reading PDF… extracting questions… tagging AOs/LOs…") with a polite cancel-and-keep-paper option.

## Technical changes

Backend: **none required**. We reuse:
- `papers` storage bucket (exists, RLS open for trial).
- `past_papers` table + `parse-paper` edge function (exists; tags AO/KO/LO, command words, sub-parts, diagrams).
- `src/lib/analyse-past-paper.ts` (already builds `assessments` + `assessment_questions` from a parsed paper, links `syllabus_doc_id` / `syllabus_paper_id` when subject+level+paper number match).

Frontend (small, additive):

1. `src/routes/new.tsx`
   - Add `mode: "scratch" | "upload"` state at the top of Step 1.
   - Render `<BuilderUploadCard />` when `mode === "upload"`.
   - Hide stepper / step 2-4 nav while in upload mode (the Coach lives on `/assessment/$id`).

2. `src/components/BuilderUploadCard.tsx` (new)
   - Mirrors the upload form in `src/routes/papers.tsx` (Title, Subject, Level, Year, Paper number, Exam board, PDF input).
   - Pre-fills Subject/Level from the builder's Step 1 selectors; lets the teacher override.
   - On submit:
     1. Upload PDF to `papers` bucket.
     2. Insert `past_papers` row with `parse_status: "pending"`.
     3. Invoke `parse-paper` edge function and **await** completion (poll `past_papers.parse_status` until `ready` or `failed`, with a 5-minute ceiling).
     4. Call `analysePastPaper({ paperId, userId })` → returns new `assessment_id`.
     5. `navigate({ to: "/assessment/$id", params: { id } })`.
   - Surfaces parse warnings (e.g. "We could only read 14 of 18 questions — you can add the rest in the editor").

3. `src/lib/analyse-past-paper.ts`
   - Tiny tweak: when the paper title contains "draft" / "incomplete" or has zero parsed sub-parts, set `assessments.status = "draft"` (already the default) and append a note to `instructions` so the Coach knows this is a work-in-progress import. Otherwise unchanged.

No DB migrations. No edge function changes. No new tables.

## Edge cases

- **Parse fails** → keep the `past_papers` row, toast the error, give the teacher a "Try again" button and a "Continue without analysis — start from scratch" fallback.
- **Slow parse (>30s)** → keep the modal, show animated steps; the parse runs server-side regardless of whether the tab is open, and the user can also navigate to `/papers` and pick it up later (existing flow).
- **No syllabus paper match** → assessment is still created; the TOS and Coach work off whatever AO/KO/LO tags `parse-paper` inferred. We surface a soft note: "Couldn't auto-link to a syllabus paper — pick one in the editor for tighter coverage."
- **Marks total mismatch** → editor already lets teachers fix marks per question; coverage rollup recomputes automatically.

## Out of scope (call out, don't build)

- A first-class "draft import" type separate from `past_paper_analysis`. The existing type already drives the right Coach + TOS surfaces; renaming it can come later if teachers find the label confusing.
- Re-OCR / re-parsing from inside the editor (already exists on `/papers`; we'll just link to it from the assessment header for imported papers).
