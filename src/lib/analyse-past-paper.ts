import { supabase } from "@/integrations/supabase/client";

// Shape of items inside past_papers.questions_json (mirrors the parse-paper
// edge function's ExtractedQuestion + classification fields written back via
// classifications during parse).
type ParsedSubPart = { label: string; text: string; marks?: number; command_word?: string };
type ParsedQuestion = {
  number: string;
  page?: number;
  command_word?: string;
  marks?: number;
  question_type?: string;
  stem: string;
  source_excerpt?: string;
  figure_refs?: number[];
  difficulty_hint?: string;
  sub_parts?: ParsedSubPart[];
  // Classification (added by parse-paper at save time).
  topic_code?: string | null;
  topic?: string | null;
  bloom_level?: string | null;
  ao_codes?: string[];
  learning_outcomes?: string[];
  knowledge_outcomes?: string[];
};

const ASSESSMENT_QUESTION_TYPES = new Set(["mcq", "structured", "essay", "short_answer"]);
const normaliseType = (raw?: string | null): string => {
  if (!raw) return "structured";
  const v = raw.toLowerCase();
  return ASSESSMENT_QUESTION_TYPES.has(v) ? v : "structured";
};

/**
 * Convert a parsed past paper into a fresh `assessments` row + its
 * `assessment_questions` rows so the existing TOS, AO/KO/LO coverage,
 * and Coach views can analyse it.
 *
 * Returns the new assessment id.
 */
export async function analysePastPaper(opts: {
  paperId: string;
  userId: string;
}): Promise<string> {
  const { paperId, userId } = opts;

  const { data: paper, error: paperErr } = await supabase
    .from("past_papers")
    .select("id, title, subject, level, year, paper_number, exam_board, questions_json")
    .eq("id", paperId)
    .single();
  if (paperErr || !paper) throw new Error(paperErr?.message ?? "Paper not found");

  const questions = (Array.isArray(paper.questions_json) ? paper.questions_json : []) as ParsedQuestion[];
  if (questions.length === 0) throw new Error("This paper has no parsed questions yet — re-parse first.");

  // Try to match the syllabus paper for duration / linkage.
  let syllabusDocId: string | null = null;
  let syllabusPaperId: string | null = null;
  let durationMinutes: number | null = null;
  if (paper.subject && paper.level) {
    const { data: docs } = await supabase
      .from("syllabus_documents")
      .select("id")
      .ilike("subject", `%${paper.subject}%`)
      .ilike("level", `%${paper.level}%`)
      .limit(1);
    syllabusDocId = (docs?.[0] as { id: string } | undefined)?.id ?? null;
    if (syllabusDocId && paper.paper_number) {
      const { data: ps } = await supabase
        .from("syllabus_papers")
        .select("id, duration_minutes")
        .eq("source_doc_id", syllabusDocId)
        .ilike("paper_number", `%${paper.paper_number}%`)
        .limit(1);
      const match = ps?.[0] as { id: string; duration_minutes: number | null } | undefined;
      if (match) {
        syllabusPaperId = match.id;
        durationMinutes = match.duration_minutes;
      }
    }
  }

  // Fetch diagrams attached to this paper so we can wire the first one to
  // each parsed question's `diagram_url`.
  const { data: diagRows } = await supabase
    .from("past_paper_diagrams")
    .select("image_path, caption, page_number")
    .eq("paper_id", paperId);
  const diagrams = (diagRows ?? []) as { image_path: string; caption: string | null; page_number: number | null }[];

  // Compute the total marks (parent + sub-parts when sub-part marks present).
  const sumMarks = questions.reduce((acc, q) => {
    const subSum = (q.sub_parts ?? []).reduce((s, sp) => s + (sp.marks ?? 0), 0);
    return acc + (subSum > 0 ? subSum : (q.marks ?? 0));
  }, 0);

  const title = `Analysis · ${paper.title}`;

  // 1. Create the assessment row.
  const { data: created, error: aErr } = await supabase
    .from("assessments")
    .insert({
      user_id: userId,
      title,
      subject: paper.subject ?? "Unknown",
      level: paper.level ?? "Unknown",
      assessment_type: "past_paper_analysis",
      total_marks: sumMarks > 0 ? sumMarks : 0,
      duration_minutes: durationMinutes ?? 60,
      status: "draft",
      syllabus_doc_id: syllabusDocId,
      syllabus_paper_id: syllabusPaperId,
      instructions: `Imported from past paper "${paper.title}".`,
      topics: [],
      blueprint: { sections: [] },
      item_sources: [{ kind: "past_paper", paper_id: paper.id, paper_title: paper.title }],
      question_types: [],
    })
    .select("id")
    .single();
  if (aErr || !created) throw new Error(aErr?.message ?? "Could not create assessment");
  const assessmentId = (created as { id: string }).id;

  // 2. Build assessment_questions rows. Sub-parts each become their own row
  //    so the TOS, AO/KO/LO coverage and Coach can score them independently.
  const rows: Array<Record<string, unknown>> = [];
  let position = 0;
  for (const q of questions) {
    const baseDiagram = (q.figure_refs ?? [])
      .map((idx) => diagrams[idx - 1] ?? diagrams[idx])
      .find((d): d is typeof diagrams[number] => Boolean(d));
    const baseDiagramUrl = baseDiagram?.image_path ?? null;

    const subParts = (q.sub_parts ?? []).filter((sp) => sp.text && sp.text.trim().length >= 20);

    if (subParts.length === 0) {
      rows.push({
        assessment_id: assessmentId,
        user_id: userId,
        position: position++,
        question_type: normaliseType(q.question_type),
        marks: q.marks ?? 0,
        difficulty: q.difficulty_hint ?? null,
        bloom_level: q.bloom_level ?? null,
        topic: q.topic ?? q.topic_code ?? null,
        stem: q.stem,
        source_excerpt: q.source_excerpt && q.source_excerpt.trim().length > 0 ? q.source_excerpt : null,
        ao_codes: q.ao_codes ?? [],
        learning_outcomes: q.learning_outcomes ?? [],
        knowledge_outcomes: q.knowledge_outcomes ?? [],
        diagram_url: baseDiagramUrl,
        diagram_caption: baseDiagram?.caption ?? null,
        diagram_source: baseDiagramUrl ? "past_paper" : null,
        notes: `From past paper · Q${q.number}`,
      });
    } else {
      // Parent stem + each sub-part as its own row. AO/KO/LO and topic
      // classifications were generated at the parent level, so reuse them
      // for sub-parts (the Coach can still flag sub-part-level issues).
      for (const sp of subParts) {
        const combinedStem = `${q.stem}\n\n(${sp.label}) ${sp.text}`;
        rows.push({
          assessment_id: assessmentId,
          user_id: userId,
          position: position++,
          question_type: normaliseType(q.question_type),
          marks: sp.marks ?? 0,
          difficulty: q.difficulty_hint ?? null,
          bloom_level: q.bloom_level ?? null,
          topic: q.topic ?? q.topic_code ?? null,
          stem: combinedStem,
          source_excerpt: q.source_excerpt && q.source_excerpt.trim().length > 0 ? q.source_excerpt : null,
          ao_codes: q.ao_codes ?? [],
          learning_outcomes: q.learning_outcomes ?? [],
          knowledge_outcomes: q.knowledge_outcomes ?? [],
          diagram_url: baseDiagramUrl,
          diagram_caption: baseDiagram?.caption ?? null,
          diagram_source: baseDiagramUrl ? "past_paper" : null,
          notes: `From past paper · Q${q.number}(${sp.label})${sp.command_word ? ` · ${sp.command_word}` : ""}`,
        });
      }
    }
  }

  if (rows.length > 0) {
    // Chunk inserts to stay safely under any row-size cap.
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error: qErr } = await supabase
        .from("assessment_questions")
        .insert(slice as unknown as never);
      if (qErr) {
        // Roll back the empty assessment so we don't leave an orphan.
        await supabase.from("assessments").delete().eq("id", assessmentId);
        throw new Error(qErr.message);
      }
    }
  }

  return assessmentId;
}
