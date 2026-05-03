## Goal

Two SS-only fixes:

1. The KO list in the Assessment Builder must show only the three SS Issues — no generic "Knowledge" or "Skills" buckets.
2. The SBQ source pool must cohere around a *specific sub-issue* (e.g. "Housing in Singapore — haves vs have-nots and national identity"), not generic Issue-level grab-bags. The 5–6 sources must all interrogate that one sub-issue so the assertion question (Q5) actually has something to evaluate.

---

## 1. KO list: Issues only (no Knowledge / Skills entries)

**Problem.** When SS topics carry `outcomeCategories` like "Knowledge", "Skills", "Values", those leak into `availableKos` and appear as KO checkboxes alongside the three Issues.

**Fix in `src/routes/new.tsx`:**

- In the page-level `availableKos` memo, when `socialStudiesPaper` is true, return `DEFAULT_SOCIAL_STUDIES_KOS` directly and ignore `outcomeCategories` from topics.
- In `SectionCard`'s `koCandidates` memo, when `availableKos` is the SS issue list, restrict candidates to that list only (drop topic-pool `outcome_categories` like Knowledge/Skills/Values for SS).
- Result: SS users see exactly three KO checkboxes — Issue 1 / 2 / 3 — and nothing else.

---

## 2. SS SBQ sources: cohere around a specific sub-issue

**Problem.** Current curated bundles are organised at the *Issue* level (citizenship, diversity, globalisation). The 5 sources within an Issue jump across unrelated cases (Singapore Pledge → Worldwide Governance Indicators → Swiss face-covering → UDHR). They don't form a single *inquiry*, so the Q5 assertion ("how far do the sources agree…") has nothing coherent to assert. The user's example: under Issue 1, an SBQ should explore something concrete like *Housing in Singapore* and use sources that all illuminate the haves/have-nots tension and what that means for Singaporean identity/citizenship.

**Fix in `supabase/functions/generate-assessment/index.ts`:**

### 2a. Restructure curated bundles around *sub-issues*, not Issues

Replace the three big SS bundles with multiple sub-issue bundles per Issue. Each sub-issue bundle has 5 sources that **all speak to the same concrete tension/case** so they can be compared, contrasted, and evaluated against a single assertion. Each bundle now carries:

- `issue: 1 | 2 | 3` (which SS Issue it belongs to, used for KO matching)
- `subIssue: string` (concrete inquiry framing, e.g. "Housing inequality and Singaporean identity")
- `assertion: string` (the controlling claim the 5 sources collectively interrogate — feeds Q5)
- `inquiryQuestion: string` (the Key Inquiry framing for Q1's intro)
- `sources: GroundedSource[]` — 5 sources, all about that specific sub-issue, including at least one *pictorial/data* source (chart, photo, infographic) per the SEAB SBQ format.

Sub-issues to seed (2–3 per Issue, expandable later):

- **Issue 1 — Citizenship & Governance**
  - *Housing inequality & national identity* — HDB EIP policy text, an NLB article on the "haves and have-nots" debate, an ST/CNA piece on million-dollar HDB resale flats, an academic/IPS commentary on class fault lines, plus a chart of Gini / housing affordability over time.
  - *Civic participation & dissent* — Pledge text, Article 14 of the Constitution, a contrasting case (e.g. Hong Kong protests / Swiss referendum), a domestic example of public consultation (Forward Singapore / Our Singapore Conversation), and a cartoon or infographic on civic engagement.
- **Issue 2 — Diverse Society**
  - *Managing racial harmony* — EIP text, MRHA / Maintenance of Religious Harmony commentary, a tudung/workplace religious-symbol case, a foreign comparator (Quebec Bill 21), and an image source (racial-harmony-day photo or poster).
  - *Migrant workers & social cohesion* — TWC2 / MOM statement, a news report on dormitory conditions during COVID, a remittance/economic-contribution data source, an opinion piece on belonging, and a photo/chart.
- **Issue 3 — Globalised World**
  - *Trade openness & worker displacement* — MTI speech on FTAs, WTO trade-share data chart, a story on a Singapore worker retrained via SkillsFuture, an international counter-case (Brexit / US tariffs), and an ILO/migrant-worker excerpt.
  - *Cultural globalisation & identity* — a Singlish/heritage commentary, a K-pop / Hollywood reach data source, a domestic counter (Speak Mandarin / SG culture pass), an academic piece on hybridisation, and an image/infographic.

Each bundle uses 5 **different hosts** so distinct-host seeding hits the 5–6 cap from curated alone.

### 2b. Bundle selection: pick *one* sub-issue per generation

Update `curatedHumanitiesSourcePool` (and the SS code path that calls it) so that for SS sections it:

1. Filters bundles whose `issue` matches the section's selected KO (Issue 1/2/3).
2. From those, picks **exactly one** sub-issue bundle (deterministic seeded pick using section id + topic, so re-runs are stable but different sections vary).
3. Returns those 5 sources only — no cross-mixing across sub-issues, no Issue-level grab-bag.

If no Issue KO is selected, fall back to a sub-issue bundle whose trigger best matches the section topic / LOs (existing topic-group regex logic, but now over sub-issue triggers).

### 2c. Wire sub-issue framing into the SBQ stems

Currently `deriveTopicNoun` produces noun phrases from raw syllabus topic text (e.g. "exploring citizenship and governance"), which is exactly the generic phrasing the user is unhappy with. For SS:

- When an SS sub-issue bundle is selected, override `topicNoun` and `inquiry` with the bundle's `subIssue` and `inquiryQuestion`.
- Pass the bundle's `assertion` into the assertion-skill question (Q5), so the prompt reads e.g. *"'Housing inequality is undermining Singaporean identity.' How far do Sources A–E support this assertion? Use all the sources and your own knowledge."* instead of a generic "shaped by the actions of the major actors involved" stem.
- Q1–Q4 stems continue to use the SBQ skill templates but with the concrete sub-issue noun phrase, so e.g. inference reads "What can you infer from Source A about *housing inequality in Singapore*?" rather than "about *exploring citizenship and governance*".

### 2d. Pictorial source slot

Each sub-issue bundle marks one source as `pictorial: true` (chart / photo / poster / infographic). The SBQ generator already supports an optional pictorial slot; ensure it picks the pictorial source when the bundle provides one so every SS SBQ paper has at least one image-based source as SEAB requires.

---

## Files touched

- `src/routes/new.tsx` — restrict `availableKos` and `koCandidates` to the three SS Issues for SS papers.
- `supabase/functions/generate-assessment/index.ts` — replace Issue-level SS bundles with sub-issue bundles (5 sources each, 1 pictorial), add deterministic sub-issue picker, route sub-issue framing into SBQ stems and the Q5 assertion.

## Out of scope

- No changes to History bundles, Section B SRQ logic, MCQ, or other subjects.
- No new schema; `pictorial` flag lives only inside the edge function bundle struct.
- Coach prompts unchanged (they read the resulting questions, which now carry the concrete sub-issue framing automatically).
