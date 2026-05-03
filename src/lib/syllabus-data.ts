import { supabase } from "@/integrations/supabase/client";

export type SyllabusLibraryPaper = {
  id: string;
  paperNumber: string;
  paperCode: string | null;
  componentName: string | null;
  marks: number | null;
  durationMinutes: number | null;
  weightingPercent: number | null;
  topicTheme: string | null;
  section: string | null;
  trackTags: string[];
  isOptional: boolean;
  assessmentMode: string | null;
};

export type SkillsOutcome = { code: string; statement: string };

export type SyllabusLibraryDoc = {
  id: string;
  title: string;
  syllabusCode: string | null;
  subject: string | null;
  level: string | null;
  syllabusYear: number | null;
  parseStatus: string;
  papers: SyllabusLibraryPaper[];
  skillsOutcomes: SkillsOutcome[];
};

export function normaliseSkillsOutcomes(raw: unknown): SkillsOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillsOutcome[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const code = (r as { code?: unknown }).code;
    const statement = (r as { statement?: unknown }).statement;
    if (typeof code === "string" && typeof statement === "string" && code.trim() && statement.trim()) {
      out.push({ code: code.trim(), statement: statement.trim() });
    }
  }
  return out;
}

export async function loadDocSkillsOutcomes(docId: string): Promise<SkillsOutcome[]> {
  const { data, error } = await supabase
    .from("syllabus_documents")
    .select("skills_outcomes")
    .eq("id", docId)
    .single();
  if (error) throw error;
  return normaliseSkillsOutcomes((data as { skills_outcomes?: unknown } | null)?.skills_outcomes);
}

export async function loadSyllabusLibrary(): Promise<SyllabusLibraryDoc[]> {
  const { data: docs, error: docsErr } = await supabase
    .from("syllabus_documents")
    .select("id, title, syllabus_code, subject, level, syllabus_year, parse_status")
    .in("parse_status", ["parsed", "published", "ready"])
    .order("syllabus_code", { ascending: true });
  if (docsErr) throw docsErr;
  if (!docs || docs.length === 0) return [];

  const ids = docs.map((d) => d.id);
  const { data: papers, error: papersErr } = await supabase
    .from("syllabus_papers")
    .select("id, source_doc_id, paper_number, paper_code, component_name, marks, duration_minutes, weighting_percent, topic_theme, position, section, track_tags, is_optional, assessment_mode")
    .in("source_doc_id", ids)
    .order("position", { ascending: true });
  if (papersErr) throw papersErr;

  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    syllabusCode: d.syllabus_code,
    subject: d.subject,
    level: d.level,
    syllabusYear: d.syllabus_year,
    parseStatus: d.parse_status,
    papers: (papers ?? [])
      .filter((p) => p.source_doc_id === d.id)
      .map((p) => ({
        id: p.id,
        paperNumber: p.paper_number,
        paperCode: p.paper_code,
        componentName: p.component_name,
        marks: p.marks,
        durationMinutes: p.duration_minutes,
        weightingPercent: p.weighting_percent,
        topicTheme: p.topic_theme,
        section: p.section,
        trackTags: (p.track_tags ?? []) as string[],
        isOptional: !!p.is_optional,
        assessmentMode: p.assessment_mode,
      })),
  }));
}

export type PaperTopic = {
  id: string;
  topicCode: string | null;
  parentCode: string | null;
  title: string;
  depth: number;
  position: number;
  strand: string | null;
  subStrand: string | null;
  learningOutcomes: string[];
  learningOutcomeCode: string | null;
  suggestedBlooms: string[];
  outcomeCategories: string[];
  aoCodes: string[];
  section: string | null;
  koContent: Record<string, string[]>;
};

export async function loadPaperTopics(paperId: string): Promise<PaperTopic[]> {
  // Prefer the syllabus_topic_papers join table (multi-track papers like
  // 5086 Paper 1 (MCQ) draw from Physics + Chemistry pools at once).
  const { data: links, error: linkErr } = await supabase
    .from("syllabus_topic_papers")
    .select("topic_id")
    .eq("paper_id", paperId);
  if (linkErr) throw linkErr;
  const linkedIds = (links ?? []).map((l) => l.topic_id as string);
  if (linkedIds.length > 0) {
    const { data, error } = await supabase
      .from("syllabus_topics")
      .select("id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcomes, learning_outcome_code, suggested_blooms, outcome_categories, ao_codes, section, ko_content")
      .in("id", linkedIds)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapTopicRow);
  }
  // Fallback: legacy single-paper ownership.
  const { data, error } = await supabase
    .from("syllabus_topics")
    .select("id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcomes, learning_outcome_code, suggested_blooms, outcome_categories, ao_codes, section, ko_content")
    .eq("paper_id", paperId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTopicRow);
}

/**
 * Load all topics for a syllabus document across every sibling paper.
 * Used when a multi-track paper (e.g. Combined Sci 5086 MCQ Paper 1) carries
 * no topics of its own — the discipline content actually lives on the
 * track-specific Papers 2/3/4. Caller filters by `section` to scope to the
 * active discipline (Physics / Chemistry / Biology).
 */
export async function loadDocTopics(docId: string): Promise<PaperTopic[]> {
  const { data, error } = await supabase
    .from("syllabus_topics")
    .select("id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcomes, learning_outcome_code, suggested_blooms, outcome_categories, ao_codes, section, ko_content")
    .eq("source_doc_id", docId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTopicRow);
}

function mapTopicRow(t: {
  id: string;
  topic_code: string | null;
  parent_code: string | null;
  title: string;
  depth: number;
  position: number;
  strand: string | null;
  sub_strand: string | null;
  learning_outcomes: string[] | null;
  learning_outcome_code?: string | null;
  suggested_blooms: string[] | null;
  outcome_categories: string[] | null;
  ao_codes: string[] | null;
  section: string | null;
  ko_content?: unknown;
}): PaperTopic {
  return {
    id: t.id,
    topicCode: t.topic_code,
    parentCode: t.parent_code,
    title: t.title,
    depth: t.depth,
    position: t.position,
    strand: t.strand,
    subStrand: t.sub_strand,
    learningOutcomes: t.learning_outcomes ?? [],
    learningOutcomeCode: t.learning_outcome_code ?? null,
    suggestedBlooms: t.suggested_blooms ?? [],
    outcomeCategories: (t.outcome_categories ?? []) as string[],
    aoCodes: (t.ao_codes ?? []) as string[],
    section: t.section,
    koContent: normaliseKoContent(t.ko_content),
  };
}

function normaliseKoContent(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const items = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (items.length > 0) out[k] = items;
    }
  }
  return out;
}

export type AssessmentObjective = {
  id: string;
  paperId: string | null;
  code: string;
  title: string | null;
  description: string | null;
  weightingPercent: number | null;
  position: number;
};

export async function loadDocAssessmentObjectives(docId: string): Promise<AssessmentObjective[]> {
  const { data, error } = await supabase
    .from("syllabus_assessment_objectives")
    .select("id, paper_id, code, title, description, weighting_percent, position")
    .eq("source_doc_id", docId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id,
    paperId: a.paper_id,
    code: a.code,
    title: a.title,
    description: a.description,
    weightingPercent: a.weighting_percent,
    position: a.position,
  }));
}
