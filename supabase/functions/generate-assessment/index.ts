import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { fetchGroundedSource, classifySubject, type GroundedSource } from "./sources.ts";
import { fetchDiagram, classifyScienceMath, questionWantsDiagram } from "./diagrams.ts";
import { fetchExemplars } from "./exemplars.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface BlueprintRow {
  topic: string;
  bloom: string;
  marks: number;
  topic_code?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  mcq: "multiple-choice (4 options, one correct)",
  short_answer: "short-answer (1-2 sentence response)",
  structured: "structured (multi-part, e.g. (a), (b), (c))",
  long: "long-answer / essay",
  comprehension: "comprehension passage with sub-questions",
  practical: "practical / applied scenario",
  source_based: "source-based with stimulus and analysis",
};

function buildSystemPrompt(subject: string, level: string, paperCode?: string | null) {
  const alignLine = paperCode
    ? `All questions must align to MOE syllabus paper ${paperCode}. Reference the topic code (e.g. §1.2) when relevant in mark schemes.`
    : "";
  return `You are an expert assessment writer for the Singapore Ministry of Education (MOE) syllabus.
You write clear, fair, age-appropriate questions for ${level} ${subject}.
Always use British English spelling and SI units. Use Singapore-relevant contexts (HDB, MRT, hawker centres, neighbourhood schools, local names like Wei Ling, Aravind, Mei Ling, Hadi) where natural.
Match MOE phrasing conventions and difficulty norms for ${level}.
${alignLine}
Each question must include a clear stem, a precise answer, and a marking scheme that breaks down marks where appropriate.
Use Bloom's taxonomy levels rigorously.
When a "GROUNDED SOURCE" block is provided for a question, you MUST:
  - Place the verbatim source text inside the question stem under a "Source A" heading (or "Passage" for English comprehension).
  - NOT paraphrase, summarise, translate, or alter the source text in any way.
  - Add a citation line directly under the source: \`Source: {publisher} — {url}\`.
  - Write your sub-questions to refer to the passage / Source A.
  - NEVER fabricate sources, attributions, or URLs of your own.`;
}

function buildUserPrompt(opts: {
  title: string; subject: string; level: string; assessmentType: string;
  totalMarks: number; durationMinutes: number;
  blueprint: BlueprintRow[]; questionTypes: string[]; itemSources: string[];
  instructions?: string;
  syllabusCode?: string | null;
  paperCode?: string | null;
  groundedSources: (GroundedSource | null)[]; // index-aligned with blueprint
}) {
  const typeStr = opts.questionTypes.map((t) => `- ${QUESTION_TYPE_LABELS[t] ?? t}`).join("\n");
  const blueprintStr = opts.blueprint
    .map((r, i) => {
      const code = r.topic_code ? ` [${r.topic_code}]` : "";
      const los = r.learning_outcomes && r.learning_outcomes.length > 0
        ? `\n   Learning outcomes: ${r.learning_outcomes.slice(0, 4).map((lo) => `• ${lo}`).join(" ")}`
        : "";
      const aos = r.ao_codes && r.ao_codes.length > 0
        ? `\n   Assessment Objectives to address: ${r.ao_codes.join(", ")}`
        : "";
      const cats = r.outcome_categories && r.outcome_categories.length > 0
        ? `\n   Outcome category: ${r.outcome_categories.join(" / ")}`
        : "";
      const src = opts.groundedSources[i];
      const grounded = src
        ? `\n   GROUNDED SOURCE (use verbatim, do not modify):\n   ---\n   ${src.excerpt}\n   ---\n   Citation: Source: ${src.publisher} — ${src.source_url}\n   Set source_excerpt to the exact text between the dashes above. Set source_url to ${src.source_url}.`
        : "";
      return `${i + 1}. Topic${code}: "${r.topic}" — Bloom: ${r.bloom} — ${r.marks} marks${los}${aos}${cats}${grounded}`;
    })
    .join("\n");

  const grounding = opts.paperCode
    ? `Aligned to MOE syllabus ${opts.syllabusCode ?? ""} paper ${opts.paperCode}.\n`
    : "";

  return `${grounding}Draft a ${opts.assessmentType} for ${opts.level} ${opts.subject} titled "${opts.title}".
Duration: ${opts.durationMinutes} minutes. Total marks: ${opts.totalMarks}.

BLUEPRINT (you MUST match the marks per topic+Bloom row):
${blueprintStr}

Allowed question types (mix appropriately, prefer earlier ones for lower marks):
${typeStr}

${opts.instructions ? `TEACHER INSTRUCTIONS:\n${opts.instructions}\n` : ""}
Generate questions whose total marks equal ${opts.totalMarks} and respect the blueprint as closely as possible.
For each question, choose ONE question_type from this exact list: ${opts.questionTypes.join(", ")}.
For MCQ, provide exactly 4 options as an array; for non-MCQ, options must be null.
Difficulty should be one of: easy, medium, hard.
Bloom_level must be one of: Remember, Understand, Apply, Analyse, Evaluate, Create.

Call the tool save_assessment with the full list of questions.`;
}

const TOOL = {
  type: "function",
  function: {
    name: "save_assessment",
    description: "Save a fully-drafted assessment with all its questions.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_type: { type: "string", enum: ["mcq", "short_answer", "structured", "long", "comprehension", "practical", "source_based"] },
              topic: { type: "string" },
              bloom_level: { type: "string", enum: ["Remember", "Understand", "Apply", "Analyse", "Evaluate", "Create"] },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              marks: { type: "integer", minimum: 1 },
              stem: { type: "string", description: "The question text. For structured questions include sub-parts (a), (b), etc. For source-based questions include the verbatim Source A block + citation, then the sub-parts." },
              options: { type: ["array", "null"], items: { type: "string" }, description: "MCQ options or null." },
              answer: { type: "string", description: "The correct answer (for MCQ, the letter and option text)." },
              mark_scheme: { type: "string", description: "Marking rubric showing how to award marks." },
              source_excerpt: { type: ["string", "null"], description: "Verbatim source passage used in the stem (only when a GROUNDED SOURCE was provided)." },
              source_url: { type: ["string", "null"], description: "URL of the source (only when a GROUNDED SOURCE was provided)." },
            },
            required: ["question_type", "topic", "bloom_level", "difficulty", "marks", "stem", "answer", "mark_scheme"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Free-trial mode: no auth required. Use the service role to bypass RLS
    // and accept the trial user id from the request body.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      assessmentId, title, subject, level, assessmentType, durationMinutes,
      totalMarks, blueprint, questionTypes, itemSources, instructions,
      userId: bodyUserId,
      syllabusCode, paperCode,
    } = body;
    const userId = bodyUserId ?? "00000000-0000-0000-0000-000000000001";

    // Pre-fetch grounded sources for History / Social Studies (SBQ) and English
    // (comprehension or source-based) rows.
    // For Humanities: EVERY question gets exactly one unique source, regardless of
    // the question type the model would have chosen. Questions without a successfully
    // fetched source are dropped after generation.
    const subjectKind = classifySubject(subject);
    const wantsSourceBased = Array.isArray(questionTypes) && questionTypes.includes("source_based");
    const wantsComprehension = Array.isArray(questionTypes) && questionTypes.includes("comprehension");
    const sourceGate =
      subjectKind === "humanities" ||
      (subjectKind === "english" && (wantsComprehension || wantsSourceBased));
    const groundedSources: (GroundedSource | null)[] = [];
    if (sourceGate && subjectKind) {
      console.log("[generate] source-grounding enabled for subject:", subject, "kind:", subjectKind);
      const usedHosts = new Set<string>();
      const usedUrls = new Set<string>();
      for (const row of blueprint as BlueprintRow[]) {
        try {
          const src = await fetchGroundedSource(subjectKind, row.topic, row.learning_outcomes ?? [], usedHosts, usedUrls);
          groundedSources.push(src);
          if (subjectKind === "humanities" && !src) {
            console.warn("[generate] humanities row has no source, will be dropped:", row.topic);
          }
        } catch (e) {
          console.warn("[generate] source fetch failed for row", row.topic, e);
          groundedSources.push(null);
        }
      }
    } else {
      for (let i = 0; i < (blueprint as BlueprintRow[]).length; i++) groundedSources.push(null);
    }

    // Fetch past-paper exemplars (auto-match by subject + level) to anchor style/difficulty.
    let exemplarBlock = "";
    try {
      const ex = await fetchExemplars(supabase, subject, level);
      exemplarBlock = ex.block;
      console.log(`[generate] exemplars: ${ex.paperCount} papers, ${ex.questionCount} questions`);
    } catch (e) {
      console.warn("[generate] exemplar fetch failed", e);
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: buildSystemPrompt(subject, level, paperCode) },
    ];
    if (exemplarBlock) messages.push({ role: "system", content: exemplarBlock });
    messages.push({ role: "user", content: buildUserPrompt({
      title, subject, level, assessmentType, totalMarks, durationMinutes,
      blueprint, questionTypes, itemSources, instructions,
      syllabusCode, paperCode, groundedSources,
    }) });

    // Call the AI gateway with retry on transient upstream errors (502/503/504).
    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages,
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "save_assessment" } },
    });
    let aiResp: Response | null = null;
    let lastErrTxt = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: aiBody,
      });
      if (aiResp.ok) break;
      lastErrTxt = await aiResp.text().catch(() => "");
      const transient = aiResp.status === 502 || aiResp.status === 503 || aiResp.status === 504;
      console.warn(`[generate] AI attempt ${attempt + 1} failed status=${aiResp.status} transient=${transient}`);
      if (!transient) break;
      // Exponential backoff: 1s, 2s
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }

    if (!aiResp || !aiResp.ok) {
      const status = aiResp?.status ?? 500;
      console.error("AI error", status, lastErrTxt.slice(0, 500));
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit, please retry" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 502 || status === 503 || status === 504) {
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable. Please try again in a moment." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "AI failed", details: lastErrTxt.slice(0, 500) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call", JSON.stringify(aiJson));
      return new Response(JSON.stringify({ error: "AI did not return structured questions" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const args = JSON.parse(toolCall.function.arguments);
    const questions: any[] = args.questions ?? [];

    // Build a normalized lookup of grounded excerpts to verify byte-equality.
    const expectedByIndex = groundedSources.map((s) => s?.excerpt ?? null);

    // Diagram cascade for science/math questions (after AI returns).
    const scienceMathKind = classifyScienceMath(subject);
    const diagramByIndex: (Awaited<ReturnType<typeof fetchDiagram>>)[] = [];
    if (scienceMathKind) {
      console.log("[generate] diagram pipeline enabled for", subject, "kind:", scienceMathKind);
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const blueprintRow = (blueprint as BlueprintRow[])[i];
        const wantDiagram = questionWantsDiagram(
          scienceMathKind,
          [q.question_type],
          q.topic ?? blueprintRow?.topic ?? "",
          blueprintRow?.learning_outcomes ?? [],
        );
        if (!wantDiagram) { diagramByIndex.push(null); continue; }
        try {
          const d = await fetchDiagram({
            supabase,
            kind: scienceMathKind,
            subject,
            level,
            topic: q.topic ?? blueprintRow?.topic ?? "",
            learningOutcomes: blueprintRow?.learning_outcomes ?? [],
            assessmentId,
          });
          diagramByIndex.push(d);
        } catch (e) {
          console.warn("[generate] diagram fetch failed for q", i, e);
          diagramByIndex.push(null);
        }
      }
    } else {
      for (let i = 0; i < questions.length; i++) diagramByIndex.push(null);
    }

    // Insert all questions
    let droppedHumanitiesNoSource = 0;
    const rows = questions.map((q, i) => {
      const expected = expectedByIndex[i] ?? null;
      let source_excerpt: string | null = q.source_excerpt ?? null;
      let source_url: string | null = q.source_url ?? null;
      let notes: string | null = null;
      let question_type: string = q.question_type;

      // Humanities: essays/long-answer questions never need a source.
      // All other Humanities question types MUST have exactly one unique source.
      const isEssay = question_type === "long" || question_type === "structured";
      if (subjectKind === "humanities" && !isEssay) {
        if (!expected) {
          // Drop this question — no source could be retrieved for a non-essay humanities question.
          droppedHumanitiesNoSource++;
          return null;
        }
        question_type = "source_based";
        source_excerpt = expected;
        source_url = groundedSources[i]?.source_url ?? null;
        if (q.source_excerpt !== expected) {
          notes = "Source excerpt enforced from retrieved citation (model attempted to alter it).";
        }
      } else {
        const needsSource = question_type === "source_based" || question_type === "comprehension";
        if (!needsSource) {
          // Structured / long / MCQ / short_answer / practical → no source attached, ever.
          source_excerpt = null;
          source_url = null;
        } else if (expected) {
          // Anti-hallucination: require exact verbatim excerpt back.
          if (source_excerpt !== expected) {
            source_excerpt = expected;
            source_url = groundedSources[i]?.source_url ?? source_url;
            notes = "Source excerpt enforced from retrieved citation (model attempted to alter it).";
          }
        } else if (sourceGate) {
          notes = "Source retrieval failed for this row — please attach a passage manually.";
          source_excerpt = null;
          source_url = null;
        }
      }

      const diag = diagramByIndex[i];
      return {
        assessment_id: assessmentId,
        user_id: userId,
        position: i,
        question_type,
        topic: q.topic ?? null,
        bloom_level: q.bloom_level ?? null,
        difficulty: q.difficulty ?? null,
        marks: q.marks ?? 1,
        stem: q.stem,
        options: q.options ?? null,
        answer: q.answer ?? null,
        mark_scheme: q.mark_scheme ?? null,
        source_excerpt,
        source_url,
        notes,
        diagram_url: diag?.url ?? null,
        diagram_source: diag?.source ?? null,
        diagram_citation: diag?.citation ?? null,
        diagram_caption: diag?.caption ?? null,
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null)
      // Re-number positions after dropping rows
      .map((r, i) => ({ ...r, position: i }));

    if (droppedHumanitiesNoSource > 0) {
      console.warn(`[generate] dropped ${droppedHumanitiesNoSource} humanities question(s) with no retrievable source`);
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("assessment_questions").insert(rows);
      if (insErr) {
        console.error("Insert error", insErr);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      questionCount: rows.length,
      groundedCount: groundedSources.filter(Boolean).length,
      diagramCount: diagramByIndex.filter(Boolean).length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
