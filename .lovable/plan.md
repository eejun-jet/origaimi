## Goal

For every source-based question (SBQ), produce a **fully written sample answer** that targets the **highest level (L4)** of that skill's Level of Response Marking Scheme (LORMS) — explicitly demonstrating the L4 moves (e.g. provenance + bias for reliability, provenance + content + limitations for utility, message + tone/provenance for comparison, etc.) where appropriate.

Currently the `answer` field on SBQs is a one-sentence meta-description ("A strong answer compares both message AND tone…") rather than an actual model answer. This change replaces that with a real exemplar response.

## Changes

### 1. `supabase/functions/generate-assessment/index.ts`

**a. Strengthen the SBQ generation prompt** (in the SBQ skill block / per-skill prompt headers around lines 112–200):
- Add an explicit `MODEL ANSWER REQUIREMENTS` block injected when `section.question_type === "source_based"`, telling the model that the `answer` field MUST be a fully-written L4 exemplar response (not a description of what a strong answer would do).
- Per skill, list the L4 moves the exemplar must demonstrate:
  - **inference**: 2 supported inferences with quoted evidence + reasoned overall conclusion.
  - **purpose**: stated purpose + provenance reasoning + content evidence + contextual knowledge.
  - **comparison**: similarity AND difference in message + tone/provenance comparison + reasoned overall judgement.
  - **utility**: content evaluation + provenance evaluation + acknowledged limitations + reasoned overall judgement.
  - **reliability**: cross-reference content vs contextual knowledge + provenance + bias analysis + reasoned balanced judgement.
  - **surprise**: what is surprising + what is not, both with source evidence and contextual knowledge + reasoned judgement.
  - **assertion**: groups every source by support/challenge with quoted evidence, weighs provenance/bias across set, reaches substantiated conclusion.
- Length guide: ~150–250 words for 5–6 mark parts, ~250–400 words for 7–8 mark parts and the assertion.
- Must quote/reference the actual provided source excerpts by their letter (Source A/B/...).
- Forbid meta-language like "A strong answer would..." — write the answer in the candidate's voice.

**b. Update the `save_assessment` tool description** (line ~1021) for the `answer` field on source-based questions to require a fully-written L4 exemplar.

**c. Replace the deterministic SBQ fallback exemplars** (lines 530–545) with actual L4 model answers per skill. These are used when grounded source fetching produces a deterministic stub. Make them concrete paragraphs that reference Source {single} / {second} / {ALL} explicitly, demonstrate the skill's L4 moves, and end with a reasoned judgement. They will read as plausible exemplars even without quoting a real excerpt (use placeholder phrasing like "the source's reference to…" since the deterministic path has source text available — pull a short snippet from `sources[i].excerpt` when present).

### 2. `supabase/functions/regenerate-question/index.ts`

When the question being regenerated is `question_type === "source_based"`:
- Append a system-level directive to the prompt that the `answer` field must be a fully written L4 exemplar following the same per-skill LORMS expectations as in (1a).
- We can derive the SBQ skill heuristically from the existing stem (look for keywords: "infer"/"message"/"suggest" → inference; "compare" → comparison; "useful"/"utility" → utility; "reliable" → reliability; "purpose"/"produced"/"agreed with" → purpose; "surprised" → surprise; "How far do Sources" → assertion). Fall back to inference.

### 3. `src/routes/assessment.$id.tsx` (rendering)

- The answer/mark-scheme block already renders `q.answer` (line ~1281). No structural change needed — once the model writes a real exemplar, it will display correctly. Verify the surrounding label says "Sample answer" rather than "Answer" for SBQs; if the existing label is generic, leave as-is. (Quick check during implementation: tweak the label only if it currently reads in a way that misleads users for SBQs.)

## Out of scope

- No DB schema change. The exemplar lives in the existing `answer` column.
- No change to mark-scheme content (LORMS descriptors) — those are correct already.
- No change to non-SBQ questions (MCQ / structured / essay) — essay model answers already exist.

## Acceptance

- New History SBQ assessments show a multi-paragraph candidate-voice model answer per sub-part that visibly performs the L4 moves of the assigned skill.
- Regenerating an SBQ produces the same quality of L4 exemplar.
- Deterministic fallback (when AI grounding fails) still produces a plausible L4 exemplar rather than the current one-sentence meta-description.
