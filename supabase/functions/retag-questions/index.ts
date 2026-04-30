import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Section = {
  letter?: string;
  num_questions?: number;
  ao_codes?: string[];
  knowledge_outcomes?: string[];
  learning_outcomes?: string[];
  topic_pool?: Array<{
    topic?: string;
    ao_codes?: string[];
    outcome_categories?: string[];
    learning_outcomes?: string[];
  }>;
};

type Question = {
  id: string;
  position: number;
  stem: string;
  answer: string | null;
  mark_scheme: string | null;
  question_type: string;
  marks: number;
  ao_codes: string[];
  knowledge_outcomes: string[];
  learning_outcomes: string[];
};

const tagTool = {
  type: "function",
  function: {
    name: "tag_question",
    description: "Assign Assessment Objectives, Knowledge Outcomes, and Learning Outcomes that the given question actually addresses.",
    parameters: {
      type: "object",
      properties: {
        ao_codes: {
          type: "array",
          items: { type: "string" },
          description: "AO codes from the allowed list that this question primarily assesses. Pick 1–3.",
        },
        knowledge_outcomes: {
          type: "array",
          items: { type: "string" },
          description: "Knowledge Outcome categories from the allowed list this question exercises.",
        },
        learning_outcomes: {
          type: "array",
          items: { type: "string" },
          description: "Verbatim Learning Outcome statements from the allowed list this question covers.",
        },
        rationale: {
          type: "string",
          description: "One short sentence explaining the choice.",
        },
      },
      required: ["ao_codes", "knowledge_outcomes", "learning_outcomes"],
      additionalProperties: false,
    },
  },
};

function poolFor(section: Section | undefined) {
  if (!section) return { aos: [], kos: [], los: [] };
  const aos = section.ao_codes && section.ao_codes.length > 0
    ? section.ao_codes
    : Array.from(new Set((section.topic_pool ?? []).flatMap((t) => t.ao_codes ?? [])));
  const kos = section.knowledge_outcomes && section.knowledge_outcomes.length > 0
    ? section.knowledge_outcomes
    : Array.from(new Set((section.topic_pool ?? []).flatMap((t) => t.outcome_categories ?? [])));
  const los = section.learning_outcomes && section.learning_outcomes.length > 0
    ? section.learning_outcomes
    : Array.from(new Set((section.topic_pool ?? []).flatMap((t) => t.learning_outcomes ?? [])));
  return { aos, kos, los };
}

function sectionAtPosition(blueprint: Section[], pos: number): Section | undefined {
  let cursor = 0;
  for (const s of blueprint) {
    const n = s.num_questions ?? 0;
    if (pos < cursor + n) return s;
    cursor += n;
  }
  return blueprint[blueprint.length - 1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { assessmentId, questionIds } = await req.json();
    if (!assessmentId) {
      return new Response(JSON.stringify({ error: "assessmentId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: assessment, error: aErr } = await supabase
      .from("assessments")
      .select("id, subject, level, blueprint, syllabus_doc_id")
      .eq("id", assessmentId)
      .single();
    if (aErr || !assessment) {
      return new Response(JSON.stringify({ error: "Assessment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let qBuilder = supabase
      .from("assessment_questions")
      .select("*")
      .eq("assessment_id", assessmentId)
      .order("position", { ascending: true });
    if (Array.isArray(questionIds) && questionIds.length > 0) {
      qBuilder = qBuilder.in("id", questionIds);
    }
    const { data: questions, error: qErr } = await qBuilder;
    if (qErr || !questions) {
      return new Response(JSON.stringify({ error: "Could not load questions" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blueprint: Section[] = Array.isArray(assessment.blueprint) ? assessment.blueprint as Section[] : [];

    const sys = `You are an expert Singapore MOE assessment tagger for ${assessment.level} ${assessment.subject}. Read each question carefully and tag it with the Assessment Objectives, Knowledge Outcomes, and Learning Outcomes it ACTUALLY addresses. Use British spelling. Only choose values from the allowed lists provided. Be precise — do not over-tag. Prefer the exact LO statements as written.`;

    const updates: Array<{ id: string; ao_codes: string[]; knowledge_outcomes: string[]; learning_outcomes: string[] }> = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const q of questions as Question[]) {
      const sec = sectionAtPosition(blueprint, q.position);
      const pool = poolFor(sec);
      if (pool.aos.length === 0 && pool.kos.length === 0 && pool.los.length === 0) {
        errors.push({ id: q.id, error: "No AO/KO/LO pool available for this section" });
        continue;
      }

      const userMsg = [
        `Question ${q.position + 1} (${q.marks} marks, type: ${q.question_type}):`,
        `Stem: ${q.stem}`,
        q.answer ? `Answer: ${q.answer}` : null,
        q.mark_scheme ? `Mark scheme: ${q.mark_scheme}` : null,
        ``,
        `Allowed Assessment Objectives: ${pool.aos.length > 0 ? pool.aos.join(", ") : "(none)"}`,
        `Allowed Knowledge Outcomes: ${pool.kos.length > 0 ? pool.kos.join(", ") : "(none)"}`,
        `Allowed Learning Outcomes:`,
        ...pool.los.map((lo) => `  • ${lo}`),
        ``,
        `Return ONLY values that appear in the allowed lists above. Tag what the question genuinely assesses, not everything plausible.`,
      ].filter(Boolean).join("\n");

      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userMsg },
            ],
            tools: [tagTool],
            tool_choice: { type: "function", function: { name: "tag_question" } },
          }),
        });

        if (aiRes.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (aiRes.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits at Settings → Workspace → Usage." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!aiRes.ok) {
          errors.push({ id: q.id, error: `AI gateway ${aiRes.status}` });
          continue;
        }

        const json = await aiRes.json();
        const call = json.choices?.[0]?.message?.tool_calls?.[0];
        if (!call) {
          errors.push({ id: q.id, error: "No tool call returned" });
          continue;
        }
        const args = JSON.parse(call.function.arguments);

        // Filter to allowed pool only — defensive guard against hallucination.
        const aoSet = new Set(pool.aos);
        const koSet = new Set(pool.kos);
        const loSet = new Set(pool.los);
        const ao = (Array.isArray(args.ao_codes) ? args.ao_codes : []).filter((x: string) => aoSet.has(x));
        const ko = (Array.isArray(args.knowledge_outcomes) ? args.knowledge_outcomes : []).filter((x: string) => koSet.has(x));
        const lo = (Array.isArray(args.learning_outcomes) ? args.learning_outcomes : []).filter((x: string) => loSet.has(x));

        updates.push({ id: q.id, ao_codes: ao, knowledge_outcomes: ko, learning_outcomes: lo });
      } catch (e) {
        errors.push({ id: q.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Apply updates
    for (const u of updates) {
      await supabase
        .from("assessment_questions")
        .update({
          ao_codes: u.ao_codes,
          knowledge_outcomes: u.knowledge_outcomes,
          learning_outcomes: u.learning_outcomes,
        })
        .eq("id", u.id);
    }

    return new Response(
      JSON.stringify({ updated: updates.length, errors, total: (questions as Question[]).length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("retag-questions error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
