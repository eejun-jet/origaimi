## Diagrams for Science & Math questions — hybrid sourcing + paper repository

This plan adds **diagram sourcing for Science and Mathematics** questions using all four strategies in a single pipeline, plus a **past-paper repository** with tagging that the generator can use as a reference (without trying to copy questions verbatim).

### Part 1 — Hybrid diagram pipeline (all 4 strategies)

For every Science / Math question that needs a diagram, the generator runs this cascade in order, stopping at the first success:

```text
Question needs diagram?
   │
   ├─ 1. Past-paper repository (your uploads)
   │     → search tagged papers for matching topic + diagram type
   │     → if a tagged figure exists, embed it with attribution
   │
   ├─ 2. Crawl & reuse (Firecrawl)
   │     → search approved sites (SEAB, MOE, Khan Academy,
   │       NRICH, OpenStax, CK-12, PhET) for a labelled figure
   │     → embed original image + visible citation
   │
   ├─ 3. AI-generate (Nano Banana Pro)
   │     → strict exam-style prompt: monochrome line art,
   │       labelled axes/components, no shading, MOE conventions
   │     → save to Supabase Storage, embed
   │
   └─ 4. Skip + flag
         → if all 3 fail, save question with notes:
           "Diagram could not be sourced — please draw / attach manually."
```

**Per-question diagram metadata** (new columns on `assessment_questions`):

- `diagram_url` — public URL of the embedded image
- `diagram_source` — `'past_paper' | 'web' | 'ai_generated' | null`
- `diagram_citation` — publisher + URL when sourced from web/past paper
- `diagram_caption` — e.g. "Figure 1: Series circuit with two resistors"

**Display style**: numbered "Figure N" block with caption underneath the question stem (MOE convention), and the citation line beneath the figure when applicable.

**Subject + question-type gating**: only triggers for `subject ∈ {Mathematics, Science, Physics, Chemistry, Biology}` AND when the question type implies a diagram (structured, source_based, or AI infers a diagram is helpful). Pure word problems are skipped.

**Allow-list for web crawl**:

- `seab.gov.sg`, `moe.gov.sg` (SG official)
- `khanacademy.org`, `openstax.org`, `ck12.org`, `phet.colorado.edu` (CC-licensed)
- `nrich.maths.org`, `mathsisfun.com` (math)
- `bbc.co.uk/bitesize` (general)
- allow crawling for all math and science related websites
- Deny: same Wikipedia / blog / Reddit list as before

### Part 2 — Past-paper repository

A tagged library of past papers you upload, that the generator can search and reference.

**Upload UI** (new page `/papers`):

- Drag-and-drop PDF upload (uses existing `references` storage bucket pattern)
- Required tags per upload: **subject**, **level**, **year**, **paper number**, **exam board** (e.g. MOE, Cambridge)
- Optional tags: **topic** (free text), **question types present** (multi-select)
- After upload: background parse via existing `parse-syllabus` infrastructure (extracts text + page screenshots)

**How AI uses the repository** (this is the realistic part — your concern is valid):

The AI **does not** try to copy or paraphrase past questions. Instead, it uses papers as:

1. **Style reference**: when generating, we pass 2–3 page screenshots of matching tagged papers as image inputs to the LLM with the instruction *"Match this paper's tone, vocabulary, mark scheme format, and difficulty — but write entirely new questions."*
2. **Diagram source**: the parser extracts diagrams + their captions during upload, indexed by topic tag. The diagram pipeline (step 1 above) searches this index first.
3. **Topic coverage check**: the generator can see which topics have already been covered in your tagged papers and bias toward (or away from) those, your choice in TOS settings.

**What we explicitly do NOT do** (because you're right that it's fragile):

- Try to extract individual questions and rewrite them — too error-prone.
- Match question structure 1:1 — too rigid.
- Use papers as ground truth for content — they're a *style* reference only.

**Repository UI** (`/papers`):

- Grid of uploaded papers with tags, page count, parse status
- Click a paper → preview pages, edit tags, delete
- Search/filter by subject, level, year, topic
- A small badge per paper: "12 diagrams indexed" / "Parsing…" / "Failed"

### Database changes


| Table                         | Change                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assessment_questions`        | Add `diagram_url text`, `diagram_source text`, `diagram_citation text`, `diagram_caption text` (all nullable)                                                                       |
| `past_papers` (new)           | `id`, `user_id`, `title`, `subject`, `level`, `year`, `paper_number`, `exam_board`, `file_path`, `parse_status`, `page_count`, `topics text[]`, `question_types text[]`, timestamps |
| `past_paper_diagrams` (new)   | `id`, `paper_id`, `page_number`, `image_path`, `caption`, `topic_tags text[]`, `bbox jsonb` (where on the page)                                                                     |
| Storage bucket `papers` (new) | Private, RLS open per current trial-mode policy. Stores uploaded PDFs and extracted diagram crops.                                                                                  |


### Edge function changes


| File                                                       | Change                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/functions/generate-assessment/diagrams.ts` (new) | `fetchDiagram(question)` runs the 4-step cascade and returns `{url, source, citation, caption}                                                                                                               |
| `supabase/functions/generate-assessment/index.ts`          | After question generation, for science/math questions, call `fetchDiagram` and attach result to the saved row. Pass past-paper screenshots as multimodal style references when matching tagged papers exist. |
| `supabase/functions/parse-paper/index.ts` (new)            | On past-paper upload: parse PDF via Gemini multimodal, extract text per page, detect figures + captions, save crops to storage, write to `past_paper_diagrams`.                                              |
| `supabase/functions/generate-diagram/index.ts` (new)       | Wraps Nano Banana Pro (`google/gemini-3-pro-image-preview` via Lovable AI) with a strict exam-style system prompt. Returns image URL after uploading to storage.                                             |


### UI changes


| File                            | Change                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/papers.tsx` (new)   | Upload + library grid + tag editor                                                                                                                       |
| `src/routes/assessment.$id.tsx` | Render `Figure N` block with caption + citation when `diagram_url` is present                                                                            |
| `src/routes/new.tsx`            | Subject-conditional info block for Math/Science explaining the 4-tier diagram cascade. Optional toggle: "Bias toward topics covered in my tagged papers" |
| `src/components/AppHeader.tsx`  | Add "Papers" nav link                                                                                                                                    |


### What you need to do

1. Approve this plan.
2. The plan reuses **Firecrawl** (already linked) and **Lovable AI Gateway** (no key needed for Nano Banana Pro). No new connectors to link.

Once approved I'll wire it all up. We can test by uploading one past O-Level Physics paper, tagging it with topic "Electricity", then generating a Physics paper on the same topic — you should see (a) figures from your tagged paper reused where they fit, (b) Khan Academy / OpenStax circuit diagrams as the next fallback, and (c) AI-generated MOE-style diagrams for anything left over.