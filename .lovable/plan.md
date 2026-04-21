

## Multi-skill SBQ selection

Currently each SBQ section locks to ONE skill via a single dropdown. Change to allow **0–5 skills per section** (multi-select), and let the generator distribute them across the questions in that section.

### What changes for the user

- The "SBQ Skill" dropdown becomes a **checkbox grid** of the 7 skills.
- Up to **5** skills can be selected; selecting a 6th is disabled with a tooltip.
- **None selected = blank** = generator picks a sensible default mix per question (current default behaviour).
- If **Assertion** is selected, the section still enforces "include 1 question worth 8 marks using all sources" but other selected skills fill the remaining questions.
- Per-question marks validation is relaxed since skills can vary; the section's total marks remain user-controlled.

### Technical changes

**1. `src/lib/sections.ts`**
- Add `sbq_skills?: SbqSkill[]` field on `Section` (array, max length 5)
- Keep `sbq_skill?: SbqSkill` for backward compat — read-side helper `getSectionSkills(section)` returns the array (migrating single → array on the fly)
- Export `MAX_SBQ_SKILLS = 5`

**2. `src/routes/new.tsx` (`SectionCard`)**
- Replace the Select with a checkbox grid of all 7 SBQ_SKILLS
- Disable un-checked boxes when 5 already selected
- Show a small hint: "Leave blank to let the AI choose, or pick up to 5 skills."
- If Assertion is checked, show a note: "Assertion contributes 1 fixed 8-mark question; remaining marks split across other selected skills."
- Drop the auto-marks-locking logic since skills now mix

**3. `supabase/functions/generate-assessment/index.ts`**
- Mirror the type: `sbq_skills?: string[]`
- Resolve effective skills: `effectiveSkills = section.sbq_skills ?? (section.sbq_skill ? [section.sbq_skill] : [])`
- Per-question skill assignment: round-robin across `effectiveSkills`. If empty → no skill block, generator falls back to today's generic SBQ prompt.
- For multi-source skills among the chosen list: fetch enough sources for the **max** `minSources` across selected skills (so Assertion in the mix means we fetch ≥3 sources for the section), and the prompt tells the model "use all sources for the Assertion question; use Source A for single-source skill questions."
- Update the per-question prompt block to specify which skill goes to which question slot

**4. No changes needed** to docx export or assessment editor header — they already display section context. The header shows "Source-Based" generically when multiple skills are present (since no single skill label fits).

### Edge cases

- 0 skills picked: fallback to current generic SBQ behaviour (existing path, no regression)
- 1 skill picked: behaves identically to today's single-skill mode
- 5 skills + 3 questions: skills are sampled (first 3 in order)
- Assertion among 2+ skills + only 2 questions: Assertion takes 1 slot (8m), other skill takes the other slot

### Files touched
- `src/lib/sections.ts`
- `src/routes/new.tsx` (SectionCard)
- `supabase/functions/generate-assessment/index.ts`

