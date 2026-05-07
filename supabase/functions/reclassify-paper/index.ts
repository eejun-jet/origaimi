// Reclassify a parsed past paper against its matching syllabus, without
// re-running the expensive PDF extraction. Useful when:
//  - the original parse-paper run had an empty/timeout classifier (which
//    leaves every question with empty AO/KO/LO arrays and breaks the
//    macro paper-set reviewer);
//  - the syllabus was updated after the paper was parsed.
//
// Body: { paper_id: string }
// Updates `past_papers.questions_json` in place with classification fields,
// then re-fans the rows into `question_bank_items`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { classifyQuestionsBatched, type ClassifyResult } from "../_shared/classify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ParsedQuestion = {
  number: string;
  marks?: number;
  command_word?: string | null;
  question_type?: string;
  stem: string;
  source_excerpt?: string | null;
  figure_refs?: number[];
  difficulty_hint?: string | null;
  sub_parts?: { label: string; text: string; marks?: number; command_word?: string | null }[];
  topic_code?: string | null;
  topic?: string | null;
  bloom_level?: string | null;
  ao_codes?: string[];
  learning_outcomes?: string[];
  knowledge_outcomes?: string[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { paper_id } = await req.json();
    if (!paper_id) {
      return json({ error: "paper_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: paper, error: pErr } = await supabase
      .from("past_papers")
      .select("id, user_id, title, subject, level, year, paper_number, exam_board, questions_json")
      .eq("id", paper_id)
      .maybeSingle();
    if (pErr || !paper) return json({ error: pErr?.message ?? "Paper not found" }, 404);

    const questions = (Array.isArray(paper.questions_json) ? paper.questions_json : []) as ParsedQuestion[];
    if (questions.length === 0) {
      return json({ error: "Paper has no parsed questions yet — re-parse first." }, 400);
    }

    const subjectName = paper.subject ?? "";
    const levelName = paper.level ?? "";
    if (!subjectName || !levelName) {
      return json({ error: "Paper is missing subject/level — cannot match a syllabus." }, 400);
    }

    const { data: syllabusDoc } = await supabase
      .from("syllabus_documents")
      .select("id")
      .eq("subject", subjectName)
      .eq("level", levelName)
      .in("parse_status", ["ready", "parsed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const syllabusDocId: string | null = (syllabusDoc as { id: string } | null)?.id ?? null;
    if (!syllabusDocId) {
      return json({ error: `No matching syllabus found for ${subjectName} / ${levelName}.` }, 400);
    }

    const { data: topics } = await supabase
      .from("syllabus_topics")
      .select("topic_code, title, learning_outcome_code, learning_outcomes, ao_codes, outcome_categories")
      .eq("source_doc_id", syllabusDocId)
      .limit(500);

    const catalogue = ((topics as Array<{
      topic_code: string | null; title: string | null; learning_outcome_code: string | null;
      learning_outcomes: string[] | null; ao_codes: string[] | null; outcome_categories: string[] | null;
    }>) ?? []).map((t) => ({
      topic_code: t.topic_code ?? "",
      title: t.title ?? "",
      learning_outcome_code: t.learning_outcome_code ?? "",
      learning_outcomes: t.learning_outcomes ?? [],
      ao_codes: t.ao_codes ?? [],
      knowledge_outcomes: t.outcome_categories ?? [],
    }));
    if (catalogue.length === 0) {
      return json({ error: "Matched syllabus has no topics — re-parse the syllabus first." }, 400);
    }

    const outcome = await classifyQuestionsBatched(
      questions.map((q) => ({
        number: q.number,
        stem: q.stem,
        command_word: q.command_word ?? null,
        marks: q.marks ?? null,
        sub_parts: q.sub_parts ?? [],
      })),
      catalogue,
      subjectName,
      levelName,
    );

    // Patch questions_json in place.
    const updated: ParsedQuestion[] = questions.map((q) => {
      const cls = outcome.classifications[q.number] as ClassifyResult | undefined;
      if (!cls) return q;
      return {
        ...q,
        topic_code: cls.topic_code || q.topic_code || null,
        topic: cls.topic_code || q.topic || null,
        bloom_level: cls.bloom_level ?? q.bloom_level ?? null,
        ao_codes: cls.ao_codes ?? [],
        learning_outcomes: cls.learning_outcomes ?? [],
        knowledge_outcomes: cls.knowledge_outcomes ?? [],
      };
    });

    await supabase
      .from("past_papers")
      .update({ questions_json: updated })
      .eq("id", paper_id);

    // Re-fan into question_bank_items (delete + reinsert by past_paper_id).
    await supabase.from("question_bank_items").delete().eq("past_paper_id", paper_id);

    const pickQType = (raw: string | undefined): string => {
      if (!raw) return "structured";
      const v = raw.toLowerCase();
      if (["mcq", "structured", "essay", "short_answer"].includes(v)) return v;
      return "structured";
    };

    const baseTags = (q: ParsedQuestion): string[] => [
      `paper:${paper.id}`,
      paper.year ? `year:${paper.year}` : null,
      paper.paper_number ? `paper_no:${paper.paper_number}` : null,
      paper.exam_board ? `board:${paper.exam_board}` : null,
      q.command_word ? `cmd:${q.command_word.toLowerCase()}` : null,
      q.difficulty_hint ? `diff:${q.difficulty_hint}` : null,
    ].filter((t): t is string => Boolean(t));

    const rows: Array<Record<string, unknown>> = [];
    for (const q of updated) {
      rows.push({
        user_id: paper.user_id,
        subject: subjectName || "Unknown",
        level: levelName || "Unknown",
        topic: q.topic_code ?? null,
        bloom_level: q.bloom_level ?? null,
        difficulty: q.difficulty_hint ?? null,
        question_type: pickQType(q.question_type),
        marks: q.marks ?? 0,
        stem: q.stem,
        answer: null,
        mark_scheme: null,
        source: "past_paper",
        tags: baseTags(q),
        past_paper_id: paper.id,
        question_number: q.number,
        command_word: q.command_word ?? null,
        source_excerpt: q.source_excerpt && q.source_excerpt.trim().length > 0 ? q.source_excerpt : null,
        diagram_paths: [],
        learning_outcomes: q.learning_outcomes ?? [],
        knowledge_outcomes: q.knowledge_outcomes ?? [],
        ao_codes: q.ao_codes ?? [],
        syllabus_doc_id: syllabusDocId,
        topic_code: q.topic_code ?? null,
        year: paper.year,
        paper_number: paper.paper_number,
        exam_board: paper.exam_board,
      });
      for (const sp of q.sub_parts ?? []) {
        if (!sp.text || sp.text.trim().length < 20) continue;
        rows.push({
          user_id: paper.user_id,
          subject: subjectName || "Unknown",
          level: levelName || "Unknown",
          topic: q.topic_code ?? null,
          bloom_level: q.bloom_level ?? null,
          difficulty: q.difficulty_hint ?? null,
          question_type: pickQType(q.question_type),
          marks: sp.marks ?? 0,
          stem: sp.text,
          answer: null,
          mark_scheme: null,
          source: "past_paper",
          tags: [...baseTags(q), sp.command_word ? `cmd:${sp.command_word.toLowerCase()}` : null, "sub_part"].filter((t): t is string => Boolean(t)),
          past_paper_id: paper.id,
          question_number: `${q.number}${sp.label}`,
          command_word: sp.command_word ?? q.command_word ?? null,
          source_excerpt: q.source_excerpt && q.source_excerpt.trim().length > 0 ? q.source_excerpt : null,
          diagram_paths: [],
          learning_outcomes: q.learning_outcomes ?? [],
          knowledge_outcomes: q.knowledge_outcomes ?? [],
          ao_codes: q.ao_codes ?? [],
          syllabus_doc_id: syllabusDocId,
          topic_code: q.topic_code ?? null,
          year: paper.year,
          paper_number: paper.paper_number,
          exam_board: paper.exam_board,
        });
      }
    }
    if (rows.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error: bErr } = await supabase.from("question_bank_items").insert(slice);
        if (bErr) console.warn("[reclassify-paper] bank insert error", bErr);
      }
    }

    return json({
      paper_id,
      classified: outcome.classified,
      total: outcome.total,
      via_ai: outcome.via_ai,
      via_fallback: outcome.via_fallback,
      failed_batches: outcome.failed_batches,
    });
  } catch (e) {
    console.error("[reclassify-paper] fatal:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
