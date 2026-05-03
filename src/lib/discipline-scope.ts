// Discipline scoping for multi-discipline subjects (e.g. Combined Science =
// Physics + Chemistry + Biology). For Combined Science the school may only
// test 2 of 3 sciences in a given paper / paper-set. We infer which
// disciplines are actually in scope from the question tags so the Coverage
// Explorer and the Assessment Coach stop flagging the un-tested science as
// "Untested" — it isn't in scope.
//
// Pure helper. Safe to import from both client routes and edge functions
// (no Supabase imports).

export const KNOWN_DISCIPLINES = ["Physics", "Chemistry", "Biology", "Practical", "General"] as const;

export function normaliseDiscipline(s: string | null | undefined): string {
  if (!s) return "General";
  const t = s.toLowerCase();
  if (t.includes("physic")) return "Physics";
  if (t.includes("chem")) return "Chemistry";
  if (t.includes("bio")) return "Biology";
  if (t.includes("practical") || t.includes("experimental")) return "Practical";
  // Trim "Combined Science — " or similar prefixes; otherwise pass through.
  return s.split(/[—–-]/).slice(-1)[0]?.trim() || s;
}

export type DisciplineLookup = {
  /** KO/LO/topic-title → normalised discipline (Physics/Chemistry/Biology/...) */
  byKO: Map<string, string>;
  byLO: Map<string, string>;
  byTopic: Map<string, string>;
  /** Every discipline present in the syllabus pool (the "universe"). */
  universe: Set<string>;
};

type SyllabusTopicLike = {
  title?: string | null;
  section?: string | null;
  outcome_categories?: string[] | null;
  learning_outcomes?: string[] | null;
};

export function buildDisciplineLookup(topics: SyllabusTopicLike[]): DisciplineLookup {
  const byKO = new Map<string, string>();
  const byLO = new Map<string, string>();
  const byTopic = new Map<string, string>();
  const universe = new Set<string>();
  for (const t of topics) {
    const disc = normaliseDiscipline(t.section ?? null);
    universe.add(disc);
    if (t.title) byTopic.set(t.title, disc);
    for (const ko of t.outcome_categories ?? []) {
      if (!byKO.has(ko)) byKO.set(ko, disc);
    }
    for (const lo of t.learning_outcomes ?? []) {
      if (!byLO.has(lo)) byLO.set(lo, disc);
    }
  }
  return { byKO, byLO, byTopic, universe };
}

type QuestionLike = {
  topic?: string | null;
  knowledge_outcomes?: string[] | null;
  learning_outcomes?: string[] | null;
};

/**
 * Infer which disciplines are in-scope for this assessment / paper-set.
 *
 * Rules:
 *   - If the syllabus universe has < 2 disciplines (e.g. pure Biology), no
 *     filtering — return null so callers know to skip scope filtering.
 *   - Otherwise, a discipline is in-scope iff at least one question is
 *     tagged to a KO / LO / topic that maps to it.
 *   - Teacher override (non-empty `override` array) wins outright.
 *   - "General" is always considered in-scope (it's the catch-all bucket
 *     for cross-discipline content).
 *   - Failsafe: if detection finds zero disciplines (e.g. tags couldn't be
 *     mapped), fall back to the full universe rather than hiding everything.
 */
export function inferInScopeDisciplines(args: {
  questions: QuestionLike[];
  topics: SyllabusTopicLike[];
  override?: string[] | null;
}): Set<string> | null {
  const lookup = buildDisciplineLookup(args.topics);
  if (lookup.universe.size < 2) return null;

  if (args.override && args.override.length > 0) {
    const o = new Set(args.override.map(normaliseDiscipline));
    o.add("General");
    return o;
  }

  const detected = new Set<string>();
  for (const q of args.questions) {
    if (q.topic && lookup.byTopic.has(q.topic)) detected.add(lookup.byTopic.get(q.topic)!);
    for (const ko of q.knowledge_outcomes ?? []) {
      if (lookup.byKO.has(ko)) detected.add(lookup.byKO.get(ko)!);
    }
    for (const lo of q.learning_outcomes ?? []) {
      if (lookup.byLO.has(lo)) detected.add(lookup.byLO.get(lo)!);
    }
  }

  if (detected.size === 0) {
    // Couldn't map anything → don't hide content; treat all disciplines as in-scope.
    return new Set(lookup.universe);
  }
  detected.add("General");
  return detected;
}
