

## History/Social Studies SBQ Skill Types

Add the 7 SBQ skill types (Inference, Purpose, Comparison, Utility, Reliability, Surprise, Assertion) to the assessment generator so SBQ sections produce proper SEAB-style questions with correct mark allocations.

### What changes for the user

In the **Sections** step of the builder, when a section's question type is "Source-Based Question" AND the subject is History or Social Studies, the section card will show a new **SBQ Skill** dropdown with the 7 skills. The generator will then produce questions matching that skill, with marks auto-validated (5–8 marks; Assertion locked to 8).

### Technical changes

**1. `src/lib/sections.ts`**
- Add optional `sbq_skill?: SbqSkill` field to `Section` type
- Export `SBQ_SKILLS` constant:
  ```ts
  export const SBQ_SKILLS = [
    { id: "inference", label: "Inference", marks: [5,6,7,8], default: 6 },
    { id: "purpose", label: "Purpose", marks: [5,6,7,8], default: 6 },
    { id: "comparison", label: "Comparison", marks: [5,6,7,8], default: 6 },
    { id: "utility", label: "Utility", marks: [6,7,8], default: 7 },
    { id: "reliability", label: "Reliability", marks: [6,7,8], default: 7 },
    { id: "surprise", label: "Surprise", marks: [5,6,7,8], default: 6 },
    { id: "assertion", label: "Assertion (Hypothesis)", marks: [8], default: 8, locked: true },
  ] as const;
  ```

**2. `src/routes/new.tsx` (`SectionCard`)**
- When `question_type === "source_based"` and subject is History/Social Studies, render the SBQ Skill dropdown
- When skill = "assertion", auto-set `marks` to 8 and `num_questions` to 1, disable marks input
- Validate per-question marks fall within the skill's allowed range

**3. `supabase/functions/generate-assessment/index.ts`**
- For SBQ sections, pass `section.sbq_skill` into the prompt builder
- Per-skill prompt templates (key requirements):
  - **Inference**: "What can you infer from Source X about [topic]? Support your answer with evidence from the source." Mark scheme rewards inference + supporting quote.
  - **Purpose**: "Why do you think [author] [produced/published] Source X? Explain your answer using details of the source and your contextual knowledge." Mark scheme rewards purpose + provenance + content evidence.
  - **Comparison**: Requires TWO sources. "How similar are Sources X and Y? Explain your answer." Mark scheme rewards similarities + differences + comparison of message/tone/provenance.
  - **Utility**: "How useful is Source X as evidence about [topic]? Explain your answer." Mark scheme rewards content utility + provenance utility + limitations.
  - **Reliability**: "How reliable is Source X as evidence about [topic]? Explain your answer." Mark scheme rewards content cross-ref + provenance + bias.
  - **Surprise**: "Are you surprised by Source X? Explain your answer." Mark scheme rewards surprise + non-surprise using contextual knowledge.
  - **Assertion (8 marks)**: Requires ALL sources in the section. "'[Hypothesis]'. How far do the sources support this assertion? Use all the sources to explain your answer." Mark scheme uses L1–L4 levels.
- Comparison sections need ≥2 sources; Assertion needs ≥3 sources — generator enforces this when fetching grounded sources.

**4. `src/routes/assessment.$id.tsx`**
- Display `sbq_skill` label in the section header when present (e.g. "Section A — Source-Based (Inference)")

**5. `src/lib/export-docx.ts`**
- Include skill label in section header in the exported .docx

### Files touched
- `src/lib/sections.ts` (add type + constant)
- `src/routes/new.tsx` (SectionCard UI)
- `supabase/functions/generate-assessment/index.ts` (per-skill prompts + source-count enforcement)
- `src/routes/assessment.$id.tsx` (header label)
- `src/lib/export-docx.ts` (header label)

No database migration needed — `sbq_skill` lives inside the existing `blueprint` JSON.

