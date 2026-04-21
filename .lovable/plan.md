

# Add N-level (G2) support to the level list

Singapore G2/N-level syllabuses use distinct codes (2125, 2126, 2127, 5105/5106/5107, 1190, 4045) and run across Sec 3N → Sec 5N. Right now the level dropdown only goes up to Sec 4 (O-level / G3 convention), so tagging these uploads cleanly needs the list extended.

## Change

In `src/lib/syllabus.ts`, extend `LEVELS`:

```text
"P1"…"P6", "Sec 1", "Sec 2",
"Sec 3", "Sec 4",            ← G3 / O-level (existing)
"Sec 3N", "Sec 4N", "Sec 5N", ← G2 / N-level (new)
"JC1", "JC2",                ← A-level (new, was missing)
```

Notes:
- The N(A) track runs Sec 1N → Sec 5N but only Sec 3N–5N actually sit national papers, so those three are the meaningful tags.
- Adding JC1/JC2 closes a gap I noticed — mentioned in earlier plans but never landed in the `LEVELS` array.

## Where this shows up

- **Upload form** (`/admin/syllabus`) — level dropdown when registering a new syllabus PDF.
- **Wizard fallback** (`/new`) — only used when no parsed syllabus exists; safe to extend.
- **Wizard syllabus picker** — unaffected; level is read from the parsed document, this just controls what tags are valid.

## Out of scope

- Auto-detecting N-level from the document filename or cover page during parse — the AI prompt already extracts a `level` field; it'll write "N(A)" or "Secondary 4 Normal (Academic)" verbatim. We keep the human-curated tag list clean and let the admin pick the right one on upload.
- Filtering the wizard picker by level — not needed yet; once you have ~20 syllabuses we can add a level filter chip row above the picker.

## Files touched

- `src/lib/syllabus.ts` — extend `LEVELS` array (single edit, ~3 lines)

After this lands, upload the 6 N-level PDFs through `/admin/syllabus` tagging them as Sec 4N (or the appropriate year), and the parser handles the rest. 5105/5106/5107 will exercise the multi-track logic the same way 5086 does.

