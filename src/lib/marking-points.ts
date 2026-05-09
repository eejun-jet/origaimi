// Hard-coded points rules for the year-round setters / markers / moderators
// scoreboard. Values intentionally in one place — tweak here to retune.
//
// Setting points are awarded per paper (split among co-setters).
// Marking points are awarded per deployment (per teacher × class), with a
// fixed-cost overhead per class plus a per-script rate. Co-markers on the same
// class split the points.
// Moderation is awarded per paper for now (per-script moderation kicks in once
// `marking_scripts` is populated in real use).

export type AssessmentType =
  | "WA1"
  | "WA2"
  | "WA3"
  | "CA1"
  | "CA2"
  | "MYE"
  | "EoY"
  | "Prelim"
  | string
  | null
  | undefined;

export type PointsPaper = {
  level: string | null;
  stream: string | null;
  assessment_type: AssessmentType;
  variant_of: string | null;
};

export const POINTS_RULES = {
  setting: {
    g3FullPaper: 2.0,
    g2VariantOfG3: 1.0,
    g2Standalone: 1.5,
    g1OrNT: 1.0,
    wa: 1.0,
    mye: 1.5,
    eoyOrPrelim: 2.0,
  },
  marking: {
    perScript: 0.02,
    perClass: 0.25,
  },
  moderation: {
    perPaper: 0.5,
    perScriptSampled: 0.05,
  },
} as const;

function isUpperOrG3Stream(level: string | null, stream: string | null): boolean {
  const s = (stream ?? "").toUpperCase();
  const l = (level ?? "").toLowerCase();
  if (s === "EXP" || s === "G3" || s === "IP") return true;
  if (/\bg3\b|express|sec\s*[34]/i.test(l)) return true;
  return false;
}

function isG2Stream(level: string | null, stream: string | null): boolean {
  const s = (stream ?? "").toUpperCase();
  const l = (level ?? "").toLowerCase();
  if (s === "NA" || s === "G2") return true;
  if (/\bg2\b|n\(a\)|\bna\b|normal\s*acad/i.test(l)) return true;
  return false;
}

function isG1Stream(level: string | null, stream: string | null): boolean {
  const s = (stream ?? "").toUpperCase();
  const l = (level ?? "").toLowerCase();
  if (s === "NT" || s === "G1") return true;
  if (/\bg1\b|n\(t\)|\bnt\b|normal\s*tech/i.test(l)) return true;
  return false;
}

function classifyAssessment(t: AssessmentType): "wa" | "mye" | "eoy" | "full" {
  const v = String(t ?? "").trim().toUpperCase();
  if (!v) return "full"; // no marker → assume full paper (e.g. EoY)
  if (v.startsWith("WA") || v.startsWith("CA")) return "wa";
  if (v === "MYE" || v.includes("MID")) return "mye";
  if (v === "EOY" || v === "EOY EXAM" || v === "EXAM" || v.includes("PRELIM") || v.includes("END")) return "eoy";
  return "full";
}

/** Setting points for a single paper (before splitting between co-setters). */
export function settingPointsFor(paper: PointsPaper): number {
  const kind = classifyAssessment(paper.assessment_type);

  // Term assessments are always 1pt regardless of level.
  if (kind === "wa") return POINTS_RULES.setting.wa;

  // Full / EoY-style papers — score by level/stream and variant relationship.
  if (isG1Stream(paper.level, paper.stream)) return POINTS_RULES.setting.g1OrNT;
  if (isG2Stream(paper.level, paper.stream)) {
    return paper.variant_of
      ? POINTS_RULES.setting.g2VariantOfG3
      : POINTS_RULES.setting.g2Standalone;
  }
  if (isUpperOrG3Stream(paper.level, paper.stream)) {
    return kind === "mye" ? POINTS_RULES.setting.mye : POINTS_RULES.setting.eoyOrPrelim;
  }
  // Fallback for unknown level — treat as full paper.
  return kind === "mye" ? POINTS_RULES.setting.mye : POINTS_RULES.setting.g3FullPaper;
}

export function markingPointsFor(scriptCount: number): number {
  return POINTS_RULES.marking.perClass + scriptCount * POINTS_RULES.marking.perScript;
}

export function moderationPointsFor(): number {
  return POINTS_RULES.moderation.perPaper;
}

/**
 * Resolve G2↔G3 sibling links for a freshly-imported batch of papers, then
 * compute and persist setting points per paper and points per deployment.
 *
 * Idempotent: safe to re-run on the same papers.
 */
export async function recomputePointsForPapers(
  supabase: { from: (t: string) => any },
  paperIds: string[],
): Promise<void> {
  if (paperIds.length === 0) return;

  // 1) Pull the affected papers + any sibling papers for the same dept/subject/year
  const { data: focal } = await supabase
    .from("marking_papers")
    .select("id, level, stream, assessment_type, variant_of, department, subject, year")
    .in("id", paperIds);
  if (!focal) return;

  type Key = { department: string | null; subject: string | null; year: number | null };
  const keys: Key[] = focal.map((p: any) => ({
    department: p.department ?? null,
    subject: p.subject ?? null,
    year: p.year ?? null,
  }));

  // Pull every paper sharing any (dept, subject, year) key — small N in practice
  let siblings: any[] = [];
  if (keys.length > 0) {
    const subjects = Array.from(new Set(keys.map((k: Key) => k.subject).filter(Boolean)));
    const years = Array.from(new Set(keys.map((k: Key) => k.year).filter((x: number | null) => x != null)));
    if (subjects.length > 0) {
      const { data } = await supabase
        .from("marking_papers")
        .select("id, level, stream, assessment_type, variant_of, department, subject, year")
        .in("subject", subjects)
        .in("year", years.length > 0 ? years : [null]);
      siblings = data ?? [];
    }
  }
  // Merge focal + siblings, dedupe by id
  const all = new Map<string, any>();
  for (const p of [...siblings, ...focal]) all.set(p.id, p);
  const allPapers = Array.from(all.values());

  // 2) Auto-link G2 variants to a G3 sibling (same dept+subject+year)
  const groups = new Map<string, any[]>();
  for (const p of allPapers) {
    const k = `${p.department ?? ""}|${p.subject ?? ""}|${p.year ?? ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  const variantUpdates: Array<{ id: string; variant_of: string | null }> = [];
  for (const [, list] of groups) {
    const g3 = list.find((p) => isUpperOrG3Stream(p.level, p.stream));
    if (!g3) continue;
    for (const p of list) {
      if (p.id === g3.id) continue;
      if (isG2Stream(p.level, p.stream) && p.variant_of !== g3.id) {
        variantUpdates.push({ id: p.id, variant_of: g3.id });
        p.variant_of = g3.id; // mutate local copy so points calc sees the link
      }
    }
  }
  for (const u of variantUpdates) {
    await supabase.from("marking_papers").update({ variant_of: u.variant_of }).eq("id", u.id);
  }

  // 3) Pull deployments for affected papers
  const affectedIds = Array.from(new Set([...paperIds, ...variantUpdates.map((v) => v.id)]));
  const paperById = new Map<string, any>();
  for (const p of allPapers) paperById.set(p.id, p);

  const { data: deps } = await supabase
    .from("marking_deployments")
    .select("id, paper_id, role, teacher_name, class_label, script_count")
    .in("paper_id", affectedIds);

  // 4) Compute + persist setting points per paper and points per deployment
  for (const id of affectedIds) {
    const p = paperById.get(id);
    if (!p) continue;
    const baseSetting = settingPointsFor(p);
    const paperDeps = (deps ?? []).filter((d: any) => d.paper_id === id);
    const setterCount = paperDeps.filter((d: any) => d.role === "setter").length || 1;

    await supabase
      .from("marking_papers")
      .update({ points_setting: round2(baseSetting) })
      .eq("id", id);

    // Co-marker grouping: split marking points between markers on same class
    const classMarkerCount = new Map<string, number>();
    for (const d of paperDeps) {
      if (d.role !== "marker") continue;
      const k = d.class_label ?? "_";
      classMarkerCount.set(k, (classMarkerCount.get(k) ?? 0) + 1);
    }

    for (const d of paperDeps) {
      let pts = 0;
      if (d.role === "setter") {
        pts = baseSetting / setterCount;
      } else if (d.role === "marker") {
        const k = d.class_label ?? "_";
        const coMarkers = classMarkerCount.get(k) ?? 1;
        pts = markingPointsFor(d.script_count ?? 0) / coMarkers;
      } else if (d.role === "moderator") {
        pts = moderationPointsFor();
      }
      await supabase.from("marking_deployments").update({ points: round2(pts) }).eq("id", d.id);
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
