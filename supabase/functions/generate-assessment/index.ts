import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface BlueprintRow { topic: string; bloom: string; marks: number }

const QUESTION_TYPE_LABELS: Record<string, string> = {
  mcq: "multiple-choice (4 options, one correct)",
  short_answer: "short-answer (1-2 sentence response)",
  structured: "structured (multi-part, e.g. (a), (b), (c))",
  long: "long-answer / essay",
  comprehension: "comprehension passage with sub-questions",
  practical: "practical / applied scenario",
  source_based: "source-based with stimulus and analysis",
};

function buildSystemPrompt(subject: string, level: string) {
  return `You are an expert assessment writer for the Singapore Ministry of Education (MOE) syllabus.
You write clear, fair, age-appropriate questions for ${level} ${subject}.
Always use British English spelling and SI units. Use Singapore-relevant contexts (HDB, MRT, hawker centres, neighbourhood schools, local names like Wei Ling, Aravind, Mei Ling, Hadi) where natural.
Match MOE phrasing conventions and difficulty norms for ${level}.
Each question must include a clear stem, a precise answer, and a marking scheme that breaks down marks where appropriate.
Use Bloom's taxonomy levels rigorously.`;
}

function buildUserPrompt(opts: {
  title: string; subject: string; level: string; assessmentType: string;
  totalMarks: number; durationMinutes: number;
  blueprint: BlueprintRow[]; questionTypes: string[]; itemSources: string[];
  instructions?: string;
}) {
  const typeStr = opts.questionTypes.map((t) => `- ${QUESTION_TYPE_LABELS[t] ?? t}`).join("\n");
  const blueprintStr = opts.blueprint
    .map((r, i) => `${i + 1}. Topic: "${r.topic}" — Bloom: ${r.bloom} — ${r.marks} marks`)
    .join("\n");

  return `Draft a ${opts.assessmentType} for ${opts.level} ${opts.subject} titled "${opts.title}".
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
              stem: { type: "string", description: "The question text. For structured questions include sub-parts (a), (b), etc." },
              options: { type: ["array", "null"], items: { type: "string" }, description: "MCQ options or null." },
              answer: { type: "string", description: "The correct answer (for MCQ, the letter and option text)." },
              mark_scheme: { type: "string", description: "Marking rubric showing how to award marks." },
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
    } = body;
    const userId = bodyUserId ?? "00000000-0000-0000-0000-000000000001";

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: buildSystemPrompt(subject, level) },
          { role: "user", content: buildUserPrompt({
            title, subject, level, assessmentType, totalMarks, durationMinutes,
            blueprint, questionTypes, itemSources, instructions,
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

    // Insert all questions
    const rows = questions.map((q, i) => ({
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
    }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("assessment_questions").insert(rows);
      if (insErr) {
        console.error("Insert error", insErr);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ ok: true, questionCount: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
