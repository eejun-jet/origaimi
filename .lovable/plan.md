# History SBQ: 5–6 sources, command-word stems, LORMS mark schemes

Right now History source-based questions:
- Pull a shared pool of **4–5 sources** (min 4, max 5)
- Use generic question stems like "What can you infer from Source A about X?"
- Have mark schemes that are roughly LORMS-shaped but not anchored to your AO3 command-word taxonomy

Three small, surgical changes — all in the generator. No UI changes; no DB changes.

## What will change

### 1. Source pool size: 5–6 (was 4–5)

The shared SBQ source pool will fetch a **minimum of 5** and a **maximum of 6** sources per History SBQ section. The pool size still scales up if the selected skills demand it (e.g. Assertion needs ≥3), but the floor moves from 4 → 5 and the ceiling from 5 → 6.

The number of fetched sources is independent of the number of sub-parts — `num_questions` is unaffected.

### 2. Question stems use your AO3 command words verbatim

Each SBQ skill will be re-mapped onto the exact phrasing from the "Command Words / Notes" column of your uploaded xlsx:

| Skill | Stem template |
|---|---|
| Inference | "What can you **infer** from Source A about [topic]?" / "What is the **message** of Source A?" / "What does Source A **tell you** about [topic]?" |
| Comparison | "**How similar** are Sources A and B?" / "**How different** are Sources A and B?" / "**How far** are Sources A and B similar in their views about [topic]?" |
| Reliability | "**How reliable** is Source A?" / "**How far can we trust** Source A?" / "**How accurate** is Source A?" / "**How far does** Source B **prove** Source A **wrong**?" |
| Surprise | "**Are you surprised** by Source A?" (anchored to either bias-detection or reliability framing per AO3.4 / AO3.5) |
| Purpose | "What is the **purpose** of Source A?" / "**Why was** Source A **created**?" / "Do you think [X] **would have agreed** with Source A?" |
| Utility | "**How useful** is Source A as evidence about [topic]?" / "**How far does** Source B **prove** Source A **wrong**?" |
| Assertion | "[Hypothesis quote]. **How far do** Sources A–F **support** this assertion?" |

These exact templates will be enforced both in:
- The **deterministic** SBQ builder (used as a hard fallback / when generation skips LLM)
- The **LLM prompt** (so model output is forced into these forms, randomised across the templates listed above to avoid every paper looking identical)

### 3. Mark schemes follow LORMS — explicitly rewards reasoning attempts

Mark schemes for every History SBQ will be rewritten as an explicit Level of Response Marking Scheme that rewards **attempts at analysis and reasoned conclusion**, not just final correctness. Generic shape applied per skill:

```text
L1 — Surface response (e.g. lifts/copies, asserts without reasoning).
L2 — Begins to engage with the source/skill but reasoning is one-sided
     or unsupported.
L3 — Develops reasoned analysis using the source AND contextual
     knowledge; reaches a partial judgement.
L4 — Sustained, balanced reasoning across both sides; weighs evidence
     and source provenance; reaches a substantiated overall judgement.
```

Each skill keeps its own L1–L4 wording (Inference rewards attempts at inferring even when evidence is thin; Reliability rewards attempts to weigh content vs provenance; Assertion rewards attempts to use ALL sources to reach a reasoned conclusion, etc.). The intent is identical to the SEAB SBQ LORMS — candidates are **awarded for attempts at different ways of analysing and reaching a reasoned conclusion**, not penalised for not landing the perfect answer.

## Technical details

All changes are confined to one file:

- `supabase/functions/generate-assessment/index.ts`
  - In the `isHumanitiesSBQ` block (~line 740): change `Math.min(5, Math.max(4, maxMinSources))` → `Math.min(6, Math.max(5, maxMinSources))`
  - In the `SBQ_SKILLS` map (~line 104): rewrite each skill's `promptHeader` to use the AO3 command-word templates above (with 2–3 phrasings per skill so output varies), and rewrite each `markScheme` as an explicit L1–L4 LORMS that awards attempts at reasoning
  - In `buildDeterministicSbqQuestions` (~line 184): rotate through the new templates (instead of a single canned phrasing per skill) so the deterministic fallback also reads like a real MOE paper

No edge-function config changes, no DB migration, no client changes.

## Out of scope

- Adding a "command words" picker in the UI (keep teachers focused on the AO/skill choice)
- Letting teachers override individual stem templates (we randomise from the syllabus list automatically)
- Touching non-History humanities (Social Studies SBQs already use the same pipeline and will inherit the same improvements; if you want to scope this strictly to History only, say the word and I'll gate by subject)