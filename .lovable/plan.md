## Root cause

When you typed *"HDB and Singaporean identity"* in the builder notes for SS Test 3, it was saved on `assessments.instructions` and is currently only injected into LLM prompts. But for **Social Studies** SBQ sections, the generator deliberately **skips the LLM** and uses a deterministic builder that picks from a hard-coded list of 3 pre-curated sub-issue bundles per Issue (`SS_SUB_ISSUE_BUNDLES` in `supabase/functions/generate-assessment/index.ts`, lines ~580–680):

- Issue 1 (Citizenship & Governance): civic participation, religious harmony in policy, public housing & social mixing
- Issue 2 (Diverse Society): the three already listed
- Issue 3 (Globalisation): the three already listed

`pickSsSubIssueBundle()` selects one of those bundles by hashing the section id — your `instructions` field is **never read**, so your "HDB and Singaporean identity" prompt has zero effect. The chosen bundle drives the contextual write-up, the curated sources, AND the sub-questions, which is why the output felt incoherent relative to what you asked for.

There IS already a bundle about HDB (`"public housing and the social mixing project"`), but it lives under Issue 1 and was not selected for your run because the hash landed on a different one, and there's no way for your text to bias the choice.

## Plan

### 1. Pipe the teacher's focus into SS bundle selection
- Pass `instructions` (top-level) and `section.instructions` (per-section) into `pickSsSubIssueBundle()` as a new `focusText` argument.
- When `focusText` is present, score every `SS_SUB_ISSUE_BUNDLES` entry on keyword overlap with the focus text (title + framing question + KO/sub-issue label + curated source titles/excerpts). If any bundle scores above a small threshold, pick the highest-scoring one **deterministically** instead of hash-rotating. For "HDB and Singaporean identity" this will lock onto the existing public-housing bundle.
- If nothing matches strongly, fall back to today's hash behaviour but log a `[generate] SS focus "<text>" did not match any curated bundle, using default` warning so we can see it in edge logs.

### 2. Add an HDB / national-identity bundle
The existing housing bundle is framed around "social mixing" (Ethnic Integration Policy). The user's phrasing is broader — HDB as a vehicle for *Singaporean identity / belonging*. Add ONE new SS sub-issue bundle under Issue 1 with:
- framing question: "How far has public housing shaped what it means to be Singaporean?"
- 4 curated sources covering: HDB's nation-building rationale (MND/HDB heritage page), the Ethnic Integration Policy, a citizen voice on belonging in HDB estates (academic/CNA commentary), and a counter-perspective (e.g. PRs vs citizens, or affordability/identity strain).
- A `contextWriteUp` paragraph aligned to AO1/AO2 + Issue 1 KOs.

This guarantees a clean match when teachers ask about HDB/identity, and broadens coverage of Issue 1 generally.

### 3. Surface the focus in the contextual write-up
When `focusText` was used to pick a bundle, prepend a single sentence to the `[CONTEXT]…[/CONTEXT]` block: *"This case study focuses on <focusText>."* So even if matching is imperfect, the students (and you) immediately see the requested framing.

### 4. Tell the user when their focus didn't take
On the assessment view, if `instructions` is non-empty AND the chosen SS bundle did not match the focus (we'll persist a `focus_match: "matched" | "fallback"` flag in the section's `notes`), show a small inline notice on the SBQ section: *"Your note "<text>" didn't match a curated SS issue; generated the closest available case instead."* So you know to either rephrase or that we need to add another bundle.

### Out of scope
- No change to History SBQ selection (its bundles already cover the canonical Singapore syllabus topics tightly).
- No live AI bundle synthesis from arbitrary teacher focus — that's the previous timeout source. We stay on the deterministic curated path; we just (a) honor the teacher's words when picking, (b) add the missing bundle, and (c) tell the user when we fell back.

### Technical files touched
- `supabase/functions/generate-assessment/index.ts` — extend `pickSsSubIssueBundle()` signature, add scoring, add new bundle, pass `instructions` + `section.instructions` through, persist `focus_match` flag, prepend focus sentence to `[CONTEXT]`.
- `src/routes/assessment.$id.tsx` — read `focus_match` from question notes and render the inline notice on SS SBQ sections.

### Verification
1. Regenerate "SS Test 3" with note "HDB and Singaporean identity" → SBQ section uses the new HDB/identity bundle (or the existing housing bundle if you keep the original wording), contextual write-up opens with the focus sentence, and sources are coherent around HDB.
2. Generate an SS paper with note "free trade and ASEAN" → picks an Issue 3 bundle.
3. Generate with note "quantum computing" (nonsense for SS) → falls back, edge log records the warning, inline notice appears in the UI.
