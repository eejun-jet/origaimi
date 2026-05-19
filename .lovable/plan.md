## Goal

Fix the SS SBQ "Background to the issue" block so it reads as a real 5–7 sentence briefing about the issue, the perspectives on it, and its context/importance — not as a meta-notice about how the sources were curated.

Two changes, both in `supabase/functions/generate-assessment/index.ts`.

## 1. Drop the `PERSPECTIVE_NOTICE` sentence from the runtime envelope

Currently (~L2835–2844) the printed `[CONTEXT]` block is:

```
<bundle.contextWriteUp>  The sources below deliberately include official, individual, foreign and expert voices, with both supportive and opposing views, so that you can weigh perspectives against each other.
```

That trailing sentence is the one the user wants gone. Change the builder to use the bundle's `contextWriteUp` verbatim:

- Delete the `PERSPECTIVE_NOTICE` constant.
- `contextBody = baseContext.trim()` (no append). If `baseContext` is empty, omit the `[CONTEXT]…[/CONTEXT]` envelope entirely (existing fallback branch already supports that).

The variety-of-perspectives **rule** stays — `assertBundlePerspectiveMix` at module load still enforces that every SS bundle has all 4 perspectives + both stances. We only stop telling the student about it in the printed paper; the curated writeup now carries the message.

## 2. Rewrite the 9 SS `contextWriteUp` values to 5–7 sentences

Every SS bundle in `SS_SUB_ISSUE_BUNDLES` (~L579 onward) gets a refreshed `contextWriteUp` that explicitly hits the three beats the user named:

1. **What the issue is about** — name the issue, define it, scope it.
2. **What the different perspectives on it are** — government/official framing, individual/citizen lived experience, foreign comparison, expert/academic view; surface supportive + opposing stances.
3. **Context and importance** — why it matters now (recent policy moves, recent events, why students should care).

Length target: 5–7 sentences, neutral tone, no "the sources below…" meta-language, no "weigh the sources to judge…" sign-off (that framing duplicates what the question stems already do).

Bundles to rewrite (titles for reference, full prose written in the edit):

1. `housing inequality and Singaporean identity`
2. `HDB public housing and Singaporean national identity`
3. `National Service and Singaporean citizenship`
4. `civic participation and the limits of dissent in Singapore`
5. `managing race and religion in everyday Singapore`
6. `migrant workers and belonging in a diverse society`
7. (and the remaining 3 SS bundles — globalisation/economic, globalisation/security, globalisation/culture)

For each bundle the new writeup will:
- Open with one sentence stating the issue and its scope.
- Two to three sentences giving the official/policy frame and the lived-experience / individual frame.
- One sentence bringing in a foreign comparison or expert view (and naming a clear opposing stance where one exists).
- One closing sentence on why the issue matters now (recent policy, recent event, demographic pressure, etc.).

## 3. Out of scope

- **History bundles** (`HUMANITIES_SBQ_BUNDLES`) are unchanged — the user complaint and the perspective rule are SS-specific.
- No change to source fetching, perspective tagging, `assertBundlePerspectiveMix`, SRQ/essay generation, mark schemes, or UI parsing of `[CONTEXT]…[/CONTEXT]`.
- No DB / schema / route changes.
- Memory file `mem://features/social-studies-source-perspectives` stays — the underlying rule is unchanged; only the student-facing surface is being removed.

## Verification

1. Generate an SS paper on `housing inequality and Singaporean identity`. The "Background to this issue" block must (a) not contain the deleted sentence, (b) read as 5–7 sentences covering issue / perspectives / importance.
2. Repeat for at least two more SS sub-issues (one Citizenship, one Globalisation strand) to confirm tone consistency.
3. Generate a History SBQ paper (e.g. Cold War origins) — the History `contextWriteUp` must render unchanged.
4. Check edge function logs at module load: `assertBundlePerspectiveMix` must still pass for all 9 SS bundles.

## Files touched

- `supabase/functions/generate-assessment/index.ts` — remove `PERSPECTIVE_NOTICE` append, rewrite 9 SS `contextWriteUp` strings.
