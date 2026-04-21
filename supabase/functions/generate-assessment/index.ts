import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { fetchGroundedSource, classifySubject, type GroundedSource } from "./sources.ts";

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
    const subjectKind = classifySubject(subject);
    const wantsSourceBased = Array.isArray(questionTypes) && questionTypes.includes("source_based");
    const wantsComprehension = Array.isArray(questionTypes) && questionTypes.includes("comprehension");
    const sourceGate =
      (subjectKind === "humanities" && wantsSourceBased) ||
      (subjectKind === "english" && (wantsComprehension || wantsSourceBased));
    const groundedSources: (GroundedSource | null)[] = [];
    if (sourceGate && subjectKind) {
      console.log("[generate] source-grounding enabled for subject:", subject, "kind:", subjectKind);
      for (const row of blueprint as BlueprintRow[]) {
        try {
          const src = await fetchGroundedSource(subjectKind, row.topic, row.learning_outcomes ?? []);
          groundedSources.push(src);
        } catch (e) {
          console.warn("[generate] source fetch failed for row", row.topic, e);
          groundedSources.push(null);
        }
      }
    } else {
      for (let i = 0; i < (blueprint as BlueprintRow[]).length; i++) groundedSources.push(null);
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: buildSystemPrompt(subject, level, paperCode) },
          { role: "user", content: buildUserPrompt({
            title, subject, level, assessmentType, totalMarks, durationMinutes,
            blueprint, questionTypes, itemSources, instructions,
            syllabusCode, paperCode, groundedSources,
          }) },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "save_assessment" } },
      }),
    });

    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error("AI error", aiResp.status, errTxt);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit, please retry" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI failed", details: errTxt }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Insert all questions
    const rows = questions.map((q, i) => {
      const expected = expectedByIndex[i] ?? null;
      let source_excerpt: string | null = q.source_excerpt ?? null;
      let source_url: string | null = q.source_url ?? null;
      let notes: string | null = null;

      if (expected) {
        // Anti-hallucination: require exact verbatim excerpt back.
        if (source_excerpt !== expected) {
          // Override with the trusted excerpt + URL we retrieved.
          source_excerpt = expected;
          source_url = groundedSources[i]?.source_url ?? source_url;
          notes = "Source excerpt enforced from retrieved citation (model attempted to alter it).";
        }
      } else if (sourceGate && (q.question_type === "source_based" || q.question_type === "comprehension")) {
        notes = "Source retrieval failed for this row — please attach a passage manually.";
        source_excerpt = null;
        source_url = null;
      }

      return {
        assessment_id: assessmentId,
        user_id: userId,
        position: i,
        question_type: q.question_type,
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
      };
    });

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("assessment_questions").insert(rows);
      if (insErr) {
        console.error("Insert error", insErr);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ ok: true, questionCount: rows.length, groundedCount: groundedSources.filter(Boolean).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
