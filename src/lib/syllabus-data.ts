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

export type SyllabusLibraryDoc = {
  id: string;
  title: string;
  syllabusCode: string | null;
  subject: string | null;
  level: string | null;
  syllabusYear: number | null;
  parseStatus: string;
  papers: SyllabusLibraryPaper[];
};

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
  suggestedBlooms: string[];
  section: string | null;
};

export async function loadPaperTopics(paperId: string): Promise<PaperTopic[]> {
  const { data, error } = await supabase
    .from("syllabus_topics")
    .select("id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcomes, suggested_blooms, section")
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
    .select("id, topic_code, parent_code, title, depth, position, strand, sub_strand, learning_outcomes, suggested_blooms, section")
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
  suggested_blooms: string[] | null;
  section: string | null;
}): PaperTopic {
  return ({
    id: t.id,
    topicCode: t.topic_code,
    parentCode: t.parent_code,
    title: t.title,
    depth: t.depth,
    position: t.position,
    strand: t.strand,
    subStrand: t.sub_strand,
    learningOutcomes: t.learning_outcomes ?? [],
    suggestedBlooms: t.suggested_blooms ?? [],
    section: t.section,
  }));
}
