## Goal

Make it a hard rule that every Social Studies SBQ source bundle includes a deliberate **variety of perspectives**, not just whatever 5 to 6 sources happen to be curated for a sub-issue. The rule should be enforceable in code (so future bundles can't quietly drift) and visible to the teacher/student framing.

## Required perspective mix (per bundle, minimum)

Each SS bundle of 5 to 6 sources must include **at least one of each** of these tags, and the 5 or 6 sources together must contain **both a supportive and an opposing stance** on the bundle's `assertion`:

- `gov_official` — Singapore government, ministry, parliamentary reply, statutory board
- `individual` — named Singaporean voice: citizen interview, op-ed, ground-up account, civil society / NGO (e.g. TWC2)
- `foreign` — non-Singapore voice: international body (OECD, ILO, UN), foreign press, comparative case (HK, Quebec, etc.)
- `expert` — academic / think-tank analysis (IPS, LKYSPP, Cambridge, NUS researcher)
- Stance balance: ≥1 source clearly **supports** the assertion AND ≥1 clearly **opposes / qualifies** it

A single source can carry one perspective tag plus a stance tag.

## Changes to `supabase/functions/generate-assessment/index.ts`

1. **Extend the SS source type** with two optional-then-required fields:
  ```ts
   type SsPerspective = 'gov_official' | 'individual' | 'foreign' | 'expert';
   type SsStance = 'supportive' | 'opposing' | 'mixed';
   // on each curated source:
   perspective: SsPerspective;
   stance: SsStance;
  ```
2. **Audit + tag every source** in `SS_SUB_ISSUE_BUNDLES` (currently ~7 bundles: housing inequality, HDB identity, National Service, civic participation, racial/religious harmony, migrant workers, immigrant integration). For each bundle, label every source's `perspective` and `stance`. Where a bundle is missing a required perspective (most likely missing `foreign` or missing an explicit `opposing` voice), **add or swap one source** so the rule is satisfied. Existing source URLs and excerpts stay where they already meet the rule; we only edit gaps.
3. **Add a bundle validator** that runs once at module load (and inside `pickSsSubIssueBundle` before returning):
  ```ts
   function assertBundlePerspectiveMix(b: SsSubIssueBundle): void
  ```
   Throws (loudly logged, returns fallback bundle) if any of the four perspective tags is missing OR if stances don't include both `supportive` and `opposing`. Logs which bundle + which rule failed so future regressions surface in edge logs.
4. **Surface the rule in the SBQ framing.** In the `[CONTEXT]` envelope appended for SS papers (~line 2683), append one fixed sentence: *"The five sources below deliberately include official, individual, foreign and expert voices, with both supportive and opposing views, so that you can weigh perspectives against each other."* This makes the variety explicit to students without leaking teacher instructions.
5. **No change to History bundles, no change to AI fallback path, no UI changes.** The teacher-facing fallback banner already exists.

## Verification

1. Re-run `SS Test 4` (National Service): inspect the rendered SBQ — confirm Q1's source block lists 5 sources and that MINDEF, PMO, IPS/CNA, parliamentary reply, and a counter/foreign voice are all present.
2. Generate an SS paper with focus "racial harmony" → check that the racial-harmony bundle now reaches the validator with a Quebec/foreign source AND at least one critical/individual voice.
3. Temporarily delete one source from a bundle in code, restart the function, confirm the validator logs the failure and falls back. Revert.
4. Read the produced `[CONTEXT]` text in the assessment view: confirm the new "deliberately include official, individual, foreign and expert voices" sentence appears, and the teacher's raw instructions are still not present.

## Out of scope

- No change to History SBQ bundles or their source format.
- No live AI source synthesis — stays deterministic / curated.
- No new UI components; the existing teacher-facing fallback banner is unchanged.

## Memory

Save a project-memory rule so future bundle additions automatically respect this constraint:

> SS SBQ source bundles MUST include a variety of perspectives: at least one government/official, one individual Singaporean, one foreign/international, one expert/academic, and both supportive and opposing stances on the bundle's assertion.

## Files touched

- `supabase/functions/generate-assessment/index.ts` — type extension, per-source tagging across SS bundles, validator, one extra sentence in SS `[CONTEXT]` envelope.
- `mem://features/social-studies-source-perspectives` (new) + `mem://index.md` (link added).