

## Source-grounded passages for History & Social Studies questions

### What this adds
For History and Social Studies (Combined Humanities) papers — especially Source-Based Question (SBQ) and source-stimulus questions — the generator will pull a **real, attributable 100–180 word excerpt** from a credible site, cite it with the source URL, and feed it to the AI as the question stimulus. The AI will write the question stem, sub-parts, and mark scheme **around** that real source instead of inventing a fake one.

### Why we need a real web-search tool
Models hallucinate quotations and URLs unless you give them actual retrieved text. To get real, attributable passages we need a search-and-scrape API. I recommend **Firecrawl** because it does both `search` (returns ranked URLs + snippets) and `scrape` (returns clean markdown of the page), in one connector — perfect for "find a source, then pull a clean excerpt".

Perplexity is an alternative (it returns answers + citations), but it summarises rather than giving raw passage text from one site, which makes attribution fuzzier. Firecrawl is the better fit for SBQ passages.

You'll be asked to link the **Firecrawl** connector. Lovable injects the API key into the server runtime — no key handling on your side.

### Allow-list of legitimate sources
The search will be restricted via Firecrawl's `search_domain_filter` so the AI never sees Wikipedia, blogs, or random content farms. Default allow-list (editable later in code):

- `nas.gov.sg`, `nlb.gov.sg`, `roots.gov.sg`, `eresources.nlb.gov.sg` (National Archives / NLB / heritage)
- `mindef.gov.sg`, `gov.sg`, `straitstimes.com`, `channelnewsasia.com`, `todayonline.com` (Singapore primary/news)
- `bbc.co.uk/news`, `bbc.co.uk/history`, `reuters.com`, `apnews.com`, `britannica.com`
- `bl.uk` (British Library), `iwm.org.uk` (Imperial War Museums), `nationalarchives.gov.uk`, `loc.gov`, `un.org`
- Explicit excludes: `wikipedia.org`, `wikiwand.com`, `quora.com`, `reddit.com`, `medium.com`, `*.blogspot.com`, `*.wordpress.com`

### How it plugs into the flow

```text
User clicks Generate (History / Social Studies, source_based selected)
   │
   ▼
generate-assessment edge function
   │
   ├─ For each blueprint row that is source_based:
   │     1. Build a query from topic + learning outcome
   │        e.g. "Singapore separation from Malaysia 1965 primary source"
   │     2. Firecrawl /search with allow-list → top 3 results
   │     3. Firecrawl /scrape on best result → clean markdown
   │     4. Extract a 100–180 word contiguous excerpt
   │        (sentence-bounded; reject if <100 or >180 words)
   │     5. If extraction fails → try next result; after 3 fails skip stimulus
   │
   ├─ Pass {excerpt, source_url, source_title, publisher} into the AI prompt
   │   as "Source A" — instruct the model to write the SBQ around it,
   │   NOT to alter the passage text, and to cite it under the stem.
   │
   └─ Save question with stem containing the verbatim source block + citation
```

### Anti-hallucination guards
1. The passage is retrieved **before** the AI runs — the AI is told "use this exact text, do not paraphrase, do not invent attribution".
2. The `save_assessment` tool gets two new fields per question: `source_excerpt` and `source_url`. The function rejects any question where the saved excerpt isn't byte-equal to what we retrieved.
3. If retrieval fails for a row, the function falls back to a regular non-source question for that row and logs a note in `assessment_questions.notes` ("Source retrieval failed for this row — please attach a source manually.") so you see it on the review page.
4. Subject gate: this whole pipeline only runs when subject matches `history`, `social studies`, or `combined humanities`, AND the question type is `source_based`. Other subjects/types are unaffected.

### UI changes
- **Assessment review page** (`src/routes/assessment.$id.tsx`): for source-based questions, render the excerpt in a bordered "Source A" block with a clickable citation line (`Source: {publisher} — {url}`).
- **TOS builder** (`src/routes/new.tsx`): add a small note under the question-type checkbox for History/Social Studies that says "Source-based questions will be grounded in real, cited passages from approved sites (no Wikipedia, no AI-fabricated sources)."

### Technical changes (for reference)

| File | Change |
|---|---|
| `supabase/functions/generate-assessment/index.ts` | Add `fetchGroundedSource(query, allowlist)` helper using Firecrawl gateway. Branch in main loop: if `subject ∈ {History, Social Studies, Combined Humanities}` and row implies `source_based`, retrieve excerpt first, then prompt the model with it. Add `source_excerpt` + `source_url` to tool schema. Validate excerpt is byte-equal post-generation. |
| `supabase/functions/generate-assessment/sources.ts` (new) | Allow-list, deny-list, query builder, excerpt extractor (sentence-bounded 100–180 words). |
| `src/routes/assessment.$id.tsx` | Render source block + citation for `source_based` questions. |
| `src/routes/new.tsx` | Subject-conditional helper text under the question-type selector. |
| Database | Add nullable `source_excerpt text` and `source_url text` columns to `assessment_questions` so the citation persists with the question. Migration only — no data backfill. |

### What you need to do
1. Approve the plan.
2. When prompted, link the **Firecrawl** connector (one click — no API key to paste).

Once those are done I'll wire everything up and we can test by generating a Combined Humanities (History) Paper 1 SBQ and checking that each question carries a real, clickable source citation.

