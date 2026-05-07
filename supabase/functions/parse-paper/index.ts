// Parse an uploaded past paper PDF: extract per-page text, detect figures with captions,
// extract verbatim question stems + a style summary so the generator can anchor
// future assessments on the paper's tone, command-words, and difficulty.
//
// We also crop each detected figure into a real PNG (via Lovable AI vision-edit mode)
// and store it in the public `diagrams` bucket so the generator can reuse the image
// directly instead of pointing at the source PDF.
//
// NEW: After extraction we fan each question (and substantive sub-part) out into
// `question_bank_items` rows tagged with subject/level/year/paper, source excerpt,
// attached diagrams, command word, marks, and — if a matching syllabus_documents
// row is found — Knowledge Outcome / Learning Outcome / Assessment Objective codes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { computeFingerprint, type FingerprintQuestion } from "./fingerprint.ts";
import { classifyQuestionsBatched, type CatalogueEntry, type ClassifyResult } from "../_shared/classify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `You are an exam-paper analyst. Given the rendered pages of a past exam paper PDF, extract:
1) Figures present on each page (caption verbatim if printed; topic_tags from question context, plus a concise figure_description so it can be re-rendered).
2) Every numbered question with its verbatim stem, command word, marks, sub-parts, AND any stimulus/source material attached to it (passage, data table, source A/B excerpts, equations) as source_excerpt.
3) For each question, list which figure indices (0-based, order matches the figures array) it visually depends on, in figure_refs.
4) A short (2-3 sentence) "style_summary" describing the paper's tone, command-word patterns, structural format, and difficulty norms.
5) Overall topic tags.
Return ONLY via the save_paper_index tool. Be exhaustive on questions and sub-parts. For each (a)(b)(i)(ii) sub-part include its own marks and stem.`;

const TOOL = {
  type: "function",
  function: {
    name: "save_paper_index",
    description: "Save the structured index of a past paper.",
    parameters: {
      type: "object",
      properties: {
        page_count: { type: "integer" },
        figures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              page_number: { type: "integer", minimum: 1 },
              caption: { type: "string" },
              topic_tags: { type: "array", items: { type: "string" } },
              figure_description: {
                type: "string",
                description: "Concise visual description of WHAT the figure shows (e.g. 'series circuit with 2 cells, ammeter, lamp'), so it can be re-rendered as a clean B&W diagram.",
              },
            },
            required: ["page_number", "caption", "topic_tags"],
            additionalProperties: false,
          },
        },
        questions: {
          type: "array",
          description: "Every printed question, in order. Use verbatim text from the paper.",
          items: {
            type: "object",
            properties: {
              number: { type: "string", description: "e.g. '1', '2', '3a' as printed." },
              page: { type: "integer", minimum: 1 },
              command_word: { type: "string", description: "e.g. Explain, Compare, Calculate, Describe." },
              marks: { type: "integer", minimum: 0 },
              question_type: {
                type: "string",
                enum: ["mcq", "structured", "essay", "source_based", "data_response", "short_answer", "practical"],
              },
              stem: { type: "string", description: "Verbatim question stem (no paraphrasing)." },
              source_excerpt: {
                type: "string",
                description: "Verbatim stimulus / source / passage / data block attached to this question, if any. Empty string if none.",
              },
              figure_refs: {
                type: "array",
                items: { type: "integer", minimum: 0 },
                description: "0-based indices into the figures array for figures this question references.",
              },
              difficulty_hint: { type: "string", enum: ["easy", "medium", "hard"] },
              sub_parts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "e.g. 'a', 'b', 'i', 'ii'." },
                    text: { type: "string" },
                    marks: { type: "integer", minimum: 0 },
                    command_word: { type: "string" },
                  },
                  required: ["label", "text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["number", "page", "stem"],
            additionalProperties: false,
          },
        },
        style_summary: {
          type: "string",
          description: "2-3 sentences describing tone, command-word patterns, structural format, and difficulty.",
        },
        topics_overall: { type: "array", items: { type: "string" } },
      },
      required: ["page_count", "figures", "questions", "style_summary"],
      additionalProperties: false,
    },
  },
};

type ExtractedSubPart = { label: string; text: string; marks?: number; command_word?: string };
type ExtractedQuestion = {
  number: string;
  page: number;
  command_word?: string;
  marks?: number;
  question_type?: string;
  stem: string;
  source_excerpt?: string;
  figure_refs?: number[];
  difficulty_hint?: string;
  sub_parts?: ExtractedSubPart[];
};
type ExtractedFigure = {
  page_number: number;
  caption: string;
  topic_tags: string[];
  figure_description?: string;
};

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { paperId } = body as { paperId: string };
    if (!paperId) {
      return new Response(JSON.stringify({ error: "paperId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("past_papers").update({ parse_status: "processing", parse_error: null }).eq("id", paperId);

    // Kick the heavy work off in the background so the worker keeps running
    // even if the calling client disconnects. Return 202 immediately.
    const work = runParse(paperId).catch(async (e) => {
      console.error("[parse-paper] runParse threw", e);
      try {
        await supabase.from("past_papers").update({
          parse_status: "failed",
          parse_error: `Unhandled: ${String(e).slice(0, 500)}`,
        }).eq("id", paperId);
      } catch (_) { /* ignore */ }
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(work);
    }
    return new Response(JSON.stringify({ accepted: true, paperId }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled in serve()", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runParse(paperId: string): Promise<void> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: paper, error: pErr } = await supabase.from("past_papers").select("*").eq("id", paperId).single();
  if (pErr || !paper) {
    await supabase.from("past_papers").update({
      parse_status: "failed", parse_error: pErr?.message ?? "paper not found",
    }).eq("id", paperId);
    return;
  }

  try {

    const filePath = (paper as { file_path: string }).file_path;
    const { data: fileBlob, error: dErr } = await supabase.storage.from("papers").download(filePath);
    if (dErr || !fileBlob) {
      await supabase.from("past_papers").update({
        parse_status: "failed", parse_error: dErr?.message ?? "download failed",
      }).eq("id", paperId);
      return;
    }
    const buf = new Uint8Array(await fileBlob.arrayBuffer());
    const lowerPath = filePath.toLowerCase();
    const isDocx =
      lowerPath.endsWith(".docx") ||
      (fileBlob.type ?? "").includes("officedocument.wordprocessingml.document");

    let userContent: unknown;
    if (isDocx) {
      const docxText = await extractDocxText(buf);
      if (!docxText.trim()) {
        await supabase.from("past_papers").update({
          parse_status: "failed", parse_error: "Could not extract any text from the .docx file",
        }).eq("id", paperId);
        return;
      }
      userContent = [
        { type: "text", text: `Index this past paper. Title: ${(paper as { title: string }).title}. Subject: ${(paper as { subject: string | null }).subject ?? "unknown"}. Level: ${(paper as { level: string | null }).level ?? "unknown"}. The paper was uploaded as a .docx — figures may not be visible, so list only figures explicitly captioned in the text. Identify every numbered question and sub-part (verbatim, with marks, command word, source_excerpt if any), and produce a style_summary.\n\n--- DOCX CONTENT ---\n${docxText}` },
      ];
    } else {
      const b64 = base64Encode(buf);
      userContent = [
        { type: "text", text: `Index this past paper. Title: ${(paper as { title: string }).title}. Subject: ${(paper as { subject: string | null }).subject ?? "unknown"}. Level: ${(paper as { level: string | null }).level ?? "unknown"}. Identify every figure (with concise visual description), every numbered question and sub-part (verbatim, with marks, command word, source_excerpt if any, figure_refs), and produce a style_summary.` },
        { type: "file", file: { filename: "paper.pdf", file_data: `data:application/pdf;base64,${b64}` } },
      ];
    }

    // Retry the index extraction up to 3 times. Use Pro for the first two
    // attempts, fall back to Flash on the final attempt — Flash is more
    // lenient under concurrent load and still tool-calls reliably.
    const attempts: Array<{ model: string; backoffMs: number }> = [
      { model: "google/gemini-2.5-pro", backoffMs: 0 },
      { model: "google/gemini-2.5-pro", backoffMs: 1500 },
      { model: "google/gemini-2.5-flash", backoffMs: 3000 },
    ];

    let toolCall: { function: { arguments: string } } | undefined;
    let lastErr = "";
    for (let i = 0; i < attempts.length; i++) {
      const { model, backoffMs } = attempts[i];
      if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
            tools: [TOOL],
            tool_choice: { type: "function", function: { name: "save_paper_index" } },
          }),
        });

        if (!aiResp.ok) {
          const txt = await aiResp.text();
          lastErr = `attempt ${i + 1}/${attempts.length} (${model}): AI ${aiResp.status}: ${txt.slice(0, 300)}`;
          console.warn("[parse-paper]", lastErr);
          // 4xx (except 408/429) is unlikely to recover — but Gateway 402
          // (no credits) we surface immediately.
          if (aiResp.status === 402) {
            await supabase.from("past_papers").update({
              parse_status: "failed",
              parse_error: "AI credits exhausted on the gateway. Top up to continue parsing.",
            }).eq("id", paperId);
            return;
          }
          continue;
        }

        const aiJson = await aiResp.json();
        const tc = aiJson.choices?.[0]?.message?.tool_calls?.[0];
        if (!tc) {
          lastErr = `attempt ${i + 1}/${attempts.length} (${model}): no tool_calls in response`;
          console.warn("[parse-paper]", lastErr, JSON.stringify(aiJson).slice(0, 400));
          continue;
        }
        toolCall = tc;
        break;
      } catch (e) {
        lastErr = `attempt ${i + 1}/${attempts.length} (${model}): ${String(e).slice(0, 300)}`;
        console.warn("[parse-paper]", lastErr);
      }
    }

    if (!toolCall) {
      await supabase.from("past_papers").update({
        parse_status: "failed",
        parse_error: `AI did not return a structured index after ${attempts.length} attempts. Last: ${lastErr}`,
      }).eq("id", paperId);
      return;
    }

    const args = JSON.parse(toolCall.function.arguments);
    const pageCount: number = args.page_count ?? 0;
    const figures: ExtractedFigure[] = args.figures ?? [];
    const questions: ExtractedQuestion[] = Array.isArray(args.questions) ? args.questions : [];
    const styleSummary: string | null = typeof args.style_summary === "string" ? args.style_summary : null;
    const topicsOverall: string[] = args.topics_overall ?? [];
    const subjectName = (paper as { subject: string | null }).subject ?? "";
    const levelName = (paper as { level: string | null }).level ?? "";
    const examBoard = (paper as { exam_board: string | null }).exam_board ?? null;
    const paperYear = (paper as { year: number | null }).year ?? null;
    const paperNumber = (paper as { paper_number: string | null }).paper_number ?? null;

    // Map figureIndex -> source PDF path (placeholder until render-paper-figures runs).
    // We DO NOT re-render figures inline anymore — it takes 15-40s per figure
    // and blows the Edge wall-clock cap on papers with many diagrams. Instead
    // we insert rows pointing at the source PDF and let render-paper-figures
    // upgrade them in the background.
    const FIG_CAP = 30;
    const cappedFigures = figures.slice(0, FIG_CAP);
    const figureIndexToPath: Record<number, string> = {};
    const sourcePdfPath = `papers/${filePath}`;

    if (cappedFigures.length > 0) {
      await supabase.from("past_paper_diagrams").delete().eq("paper_id", paperId);
      const rows = cappedFigures.map((f, i) => {
        figureIndexToPath[i] = sourcePdfPath;
        return {
          paper_id: paperId,
          page_number: f.page_number,
          image_path: sourcePdfPath,
          caption: f.caption,
          topic_tags: f.topic_tags,
          bbox: null,
          // Stash render hints in caption metadata so render-paper-figures
          // can re-render without re-running the full extraction.
          // We append a fenced JSON block which the renderer will strip.
        };
      });
      // Persist render hints separately on the rows via a side-channel: encode
      // figure_description into the caption suffix so render-paper-figures can
      // pick it up. Simpler than adding a new column.
      const rowsWithHints = rows.map((r, i) => ({
        ...r,
        caption: cappedFigures[i].figure_description
          ? `${r.caption}\n<!--render:${JSON.stringify({ d: cappedFigures[i].figure_description, s: subjectName, l: levelName })}-->`
          : r.caption,
      }));
      await supabase.from("past_paper_diagrams").insert(rowsWithHints);
    }

    // Try to classify questions against a matching syllabus document.
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
    let classifications: Record<string, ClassifyResult> = {};

    if (syllabusDocId && questions.length > 0) {
      try {
        const { data: topics } = await supabase
          .from("syllabus_topics")
          .select("topic_code, title, learning_outcome_code, learning_outcomes, ao_codes, outcome_categories")
          .eq("source_doc_id", syllabusDocId)
          .limit(500);

        const topicCatalogue = ((topics as SyllabusTopicRow[]) ?? []).map((t) => ({
          topic_code: t.topic_code ?? "",
          title: t.title ?? "",
          learning_outcome_code: t.learning_outcome_code ?? "",
          learning_outcomes: t.learning_outcomes ?? [],
          ao_codes: t.ao_codes ?? [],
          knowledge_outcomes: t.outcome_categories ?? [],
        }));

        if (topicCatalogue.length > 0) {
          const outcome = await classifyQuestionsBatched(
            questions.map((q) => ({
              number: q.number,
              stem: q.stem,
              command_word: q.command_word ?? null,
              marks: q.marks ?? null,
              sub_parts: q.sub_parts ?? [],
            })),
            topicCatalogue,
            subjectName,
            levelName,
          );
          classifications = outcome.classifications;
        }
      } catch (e) {
        console.warn("[parse-paper] classifier failed", e);
      }
    }

    // Fan questions out into question_bank_items (idempotent for this paper).
    await supabase
      .from("question_bank_items")
      .delete()
      .eq("past_paper_id", paperId);

    const bankRows = buildBankRows({
      questions,
      paper: paper as PaperShape,
      figureIndexToPath,
      classifications,
      syllabusDocId,
      topicsOverall,
      subjectName,
      levelName,
      examBoard,
      paperYear,
      paperNumber,
    });

    if (bankRows.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < bankRows.length; i += CHUNK) {
        const slice = bankRows.slice(i, i + CHUNK);
        const { error: bErr } = await supabase
          .from("question_bank_items")
          .insert(slice);
        if (bErr) console.warn("[parse-paper] bank insert error", bErr);
      }
    }

    // Compute the difficulty fingerprint so the Coach + Builder can compare
    // future generated papers against this specimen / past paper.
    const fingerprintQuestions: FingerprintQuestion[] = questions.map((q) => {
      const cls = classifications[q.number];
      return {
        marks: q.marks ?? null,
        command_word: q.command_word ?? null,
        stem: q.stem ?? null,
        bloom_level: cls?.bloom_level ?? null,
        ao_codes: cls?.ao_codes ?? [],
        sub_parts: q.sub_parts ?? null,
      };
    });
    const difficultyFingerprint = computeFingerprint(fingerprintQuestions, {
      title: (paper as { title: string }).title,
      notes: (paper as { notes?: string | null }).notes ?? null,
      paper_number: paperNumber,
    });

    await supabase.from("past_papers").update({
      parse_status: "ready",
      page_count: pageCount,
      topics: topicsOverall,
      questions_json: questions,
      style_summary: styleSummary,
      difficulty_fingerprint: difficultyFingerprint,
    }).eq("id", paperId);

    // Kick off background figure rendering — fire and forget; if it fails the
    // paper is still usable (diagrams just point at the source PDF).
    if (cappedFigures.length > 0) {
      try {
        const renderWork = supabase.functions.invoke("render-paper-figures", {
          body: { paperId },
        });
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          EdgeRuntime.waitUntil(renderWork);
        }
      } catch (e) {
        console.warn("[parse-paper] failed to kick render-paper-figures", e);
      }
    }
  } catch (e) {
    console.error("[parse-paper] runParse caught", e);
    await supabase.from("past_papers").update({
      parse_status: "failed",
      parse_error: `Unhandled: ${String(e).slice(0, 500)}`,
    }).eq("id", paperId);
  }
}

// ---------- helpers ----------

type SyllabusTopicRow = {
  topic_code: string | null;
  title: string | null;
  learning_outcome_code: string | null;
  learning_outcomes: string[] | null;
  ao_codes: string[] | null;
  outcome_categories: string[] | null;
};

type TopicCatalogueEntry = {
  topic_code: string;
  title: string;
  learning_outcome_code: string;
  learning_outcomes: string[];
  ao_codes: string[];
  knowledge_outcomes: string[];
};

type ClassifyResult = {
  topic_code: string;
  learning_outcomes: string[];
  knowledge_outcomes: string[];
  ao_codes: string[];
  bloom_level: string | null;
};

type PaperShape = { id: string; user_id: string; title: string };

async function classifyQuestions(
  questions: ExtractedQuestion[],
  catalogue: TopicCatalogueEntry[],
  subject: string,
  level: string,
): Promise<Record<string, ClassifyResult>> {
  // Compact catalogue for the prompt — keep sizes manageable.
  const catalogueText = catalogue.slice(0, 200).map((t, i) =>
    `[${i}] code=${t.topic_code} title="${t.title}" LO_code=${t.learning_outcome_code} LOs=${(t.learning_outcomes ?? []).slice(0, 6).join("|")} AOs=${(t.ao_codes ?? []).join(",")} KOs=${(t.knowledge_outcomes ?? []).slice(0, 4).join("|")}`,
  ).join("\n");

  const items = questions.map((q) => ({
    number: q.number,
    stem: (q.stem ?? "").slice(0, 800),
    sub_parts: (q.sub_parts ?? []).slice(0, 8).map((s) => ({ label: s.label, text: (s.text ?? "").slice(0, 400) })),
    command_word: q.command_word ?? null,
    marks: q.marks ?? null,
  }));

  const TOOL_CLASSIFY = {
    type: "function",
    function: {
      name: "save_classifications",
      description: "Map each question to syllabus topic_code, learning_outcomes, knowledge_outcomes, ao_codes, bloom_level.",
      parameters: {
        type: "object",
        properties: {
          mappings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question_number: { type: "string" },
                topic_code: { type: "string" },
                learning_outcomes: { type: "array", items: { type: "string" } },
                knowledge_outcomes: { type: "array", items: { type: "string" } },
                ao_codes: { type: "array", items: { type: "string" } },
                bloom_level: {
                  type: "string",
                  enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"],
                },
              },
              required: ["question_number"],
              additionalProperties: false,
            },
          },
        },
        required: ["mappings"],
        additionalProperties: false,
      },
    },
  };

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You map past-paper exam questions to a syllabus catalogue. For each question pick exactly one topic_code from the catalogue, then list the specific learning_outcomes, knowledge_outcomes (high-level outcome categories), and ao_codes (assessment objectives) it tests. Add a Bloom level. Use exact codes/strings from the catalogue. Subject: ${subject}. Level: ${level}.`,
        },
        {
          role: "user",
          content: `CATALOGUE:\n${catalogueText}\n\nQUESTIONS:\n${JSON.stringify(items)}`,
        },
      ],
      tools: [TOOL_CLASSIFY],
      tool_choice: { type: "function", function: { name: "save_classifications" } },
    }),
  });

  if (!resp.ok) {
    console.warn("[classify] AI failed", resp.status, (await resp.text()).slice(0, 200));
    return {};
  }
  const json = await resp.json();
  const tc = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) return {};
  let parsed: { mappings?: Array<Partial<ClassifyResult> & { question_number?: string }> } = {};
  try { parsed = JSON.parse(tc.function.arguments); } catch { return {}; }
  const out: Record<string, ClassifyResult> = {};
  for (const m of parsed.mappings ?? []) {
    if (!m.question_number) continue;
    out[m.question_number] = {
      topic_code: m.topic_code ?? "",
      learning_outcomes: Array.isArray(m.learning_outcomes) ? m.learning_outcomes : [],
      knowledge_outcomes: Array.isArray(m.knowledge_outcomes) ? m.knowledge_outcomes : [],
      ao_codes: Array.isArray(m.ao_codes) ? m.ao_codes : [],
      bloom_level: typeof m.bloom_level === "string" ? m.bloom_level : null,
    };
  }
  return out;
}

function buildBankRows(opts: {
  questions: ExtractedQuestion[];
  paper: PaperShape;
  figureIndexToPath: Record<number, string>;
  classifications: Record<string, ClassifyResult>;
  syllabusDocId: string | null;
  topicsOverall: string[];
  subjectName: string;
  levelName: string;
  examBoard: string | null;
  paperYear: number | null;
  paperNumber: string | null;
}): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const fallbackTopic = (opts.topicsOverall ?? [])[0] ?? null;

  const pickQuestionType = (raw: string | undefined): string => {
    if (!raw) return "structured";
    const v = raw.toLowerCase();
    if (v === "mcq" || v === "structured" || v === "essay" || v === "short_answer") return v;
    if (v === "source_based") return "structured";
    if (v === "data_response") return "structured";
    if (v === "practical") return "structured";
    return "structured";
  };

  for (const q of opts.questions) {
    const cls = opts.classifications[q.number];
    const figurePaths = (q.figure_refs ?? [])
      .map((idx) => opts.figureIndexToPath[idx])
      .filter((p): p is string => Boolean(p));

    const baseTags = [
      `paper:${opts.paper.id}`,
      opts.paperYear ? `year:${opts.paperYear}` : null,
      opts.paperNumber ? `paper_no:${opts.paperNumber}` : null,
      opts.examBoard ? `board:${opts.examBoard}` : null,
      q.command_word ? `cmd:${q.command_word.toLowerCase()}` : null,
      q.difficulty_hint ? `diff:${q.difficulty_hint}` : null,
    ].filter((t): t is string => Boolean(t));

    // Parent question row
    rows.push({
      user_id: opts.paper.user_id,
      subject: opts.subjectName || "Unknown",
      level: opts.levelName || "Unknown",
      topic: cls?.topic_code || fallbackTopic,
      bloom_level: cls?.bloom_level ?? null,
      difficulty: q.difficulty_hint ?? null,
      question_type: pickQuestionType(q.question_type),
      marks: q.marks ?? 0,
      stem: q.stem,
      answer: null,
      mark_scheme: null,
      source: "past_paper",
      tags: baseTags,
      past_paper_id: opts.paper.id,
      question_number: q.number,
      command_word: q.command_word ?? null,
      source_excerpt: q.source_excerpt && q.source_excerpt.trim().length > 0 ? q.source_excerpt : null,
      diagram_paths: figurePaths,
      learning_outcomes: cls?.learning_outcomes ?? [],
      knowledge_outcomes: cls?.knowledge_outcomes ?? [],
      ao_codes: cls?.ao_codes ?? [],
      syllabus_doc_id: opts.syllabusDocId,
      topic_code: cls?.topic_code ?? null,
      year: opts.paperYear,
      paper_number: opts.paperNumber,
      exam_board: opts.examBoard,
    });

    // Sub-part rows (only substantive ones — text length > 20 chars)
    for (const sp of q.sub_parts ?? []) {
      if (!sp.text || sp.text.trim().length < 20) continue;
      rows.push({
        user_id: opts.paper.user_id,
        subject: opts.subjectName || "Unknown",
        level: opts.levelName || "Unknown",
        topic: cls?.topic_code || fallbackTopic,
        bloom_level: cls?.bloom_level ?? null,
        difficulty: q.difficulty_hint ?? null,
        question_type: pickQuestionType(q.question_type),
        marks: sp.marks ?? 0,
        stem: sp.text,
        answer: null,
        mark_scheme: null,
        source: "past_paper",
        tags: [...baseTags, sp.command_word ? `cmd:${sp.command_word.toLowerCase()}` : null, "sub_part"].filter((t): t is string => Boolean(t)),
        past_paper_id: opts.paper.id,
        question_number: `${q.number}${sp.label}`,
        command_word: sp.command_word ?? q.command_word ?? null,
        source_excerpt: q.source_excerpt && q.source_excerpt.trim().length > 0 ? q.source_excerpt : null,
        diagram_paths: figurePaths,
        learning_outcomes: cls?.learning_outcomes ?? [],
        knowledge_outcomes: cls?.knowledge_outcomes ?? [],
        ao_codes: cls?.ao_codes ?? [],
        syllabus_doc_id: opts.syllabusDocId,
        topic_code: cls?.topic_code ?? null,
        year: opts.paperYear,
        paper_number: opts.paperNumber,
        exam_board: opts.examBoard,
      });
    }
  }

  return rows;
}

async function renderAndUploadFigure(opts: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  paperId: string;
  figure: { page_number: number; caption: string; topic_tags: string[]; figure_description?: string };
  subject: string;
  level: string;
}): Promise<string | null> {
  const { supabase, paperId, figure, subject, level } = opts;
  const desc = (figure.figure_description ?? "").trim();
  const caption = (figure.caption ?? "").trim();
  const tags = (figure.topic_tags ?? []).join(", ");
  const description = desc || caption || tags;
  if (!description) return null;

  const subj = subject || "science";
  const lvl = level || "secondary";
  const prompt = `Re-render this figure from a Singapore MOE ${lvl} ${subj} past paper as a clean exam-style diagram.

What the figure shows: ${description}
${caption ? `Original caption: ${caption}` : ""}
${tags ? `Topic context: ${tags}` : ""}

Requirements:
- Clean black-and-white line art only (no shading, no colour, no gradients).
- White background.
- Clear, legible labels in plain sans-serif (component names, axes, units).
- Match the visual conventions used in Singapore O-Level / PSLE past papers.
- No watermarks, no captions inside the image, no decorative elements.
- Diagram only — no question text.`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!resp.ok) {
      console.warn("[parse-paper] figure render failed", resp.status, await resp.text());
      return null;
    }
    const json = await resp.json();
    const dataUrl: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl?.startsWith("data:")) return null;

    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma);
    const b64 = dataUrl.slice(comma + 1);
    const contentType = meta.split(";")[0] || "image/png";
    const ext = contentType.split("/")[1] ?? "png";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const key = `specimen/${paperId}/${crypto.randomUUID()}.${ext}`;
    const upload = await supabase.storage.from("diagrams").upload(key, bytes, {
      contentType, upsert: false,
    });
    if (upload.error) {
      console.warn("[parse-paper] figure upload failed", upload.error);
      return null;
    }
    return key;
  } catch (e) {
    console.warn("[parse-paper] figure render exception", e);
    return null;
  }
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

// Extract plain text from a .docx file (a ZIP containing word/document.xml).
// We use the standard `JSZip` ESM build to unzip in Deno, then strip XML tags
// while preserving paragraph breaks.
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
  const zip = await JSZip.loadAsync(bytes);
  const parts: string[] = [];
  // Main body
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (docXml) parts.push(docXmlToText(docXml));
  // Headers and footers (often contain title / paper number info)
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name)) {
      const x = await zip.file(name)?.async("string");
      if (x) parts.push(docXmlToText(x));
    }
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function docXmlToText(xml: string): string {
  // Insert paragraph and line breaks before stripping tags.
  let s = xml
    .replace(/<\/w:p\s*>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t");
  // Strip every XML tag
  s = s.replace(/<[^>]+>/g, "");
  // Decode common XML entities
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  return s;
}
