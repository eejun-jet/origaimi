import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const TOOL = {
  type: "function",
  function: {
    name: "rewrite_question",
    description: "Provide a regenerated question.",
    parameters: {
      type: "object",
      properties: {
        stem: { type: "string" },
        options: { type: ["array", "null"], items: { type: "string" } },
        answer: { type: "string" },
        mark_scheme: { type: "string" },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        ao_codes: { type: ["array", "null"], items: { type: "string" }, description: "Assessment Objective codes the question addresses (e.g. AO1, AO2)." },
        knowledge_outcomes: { type: ["array", "null"], items: { type: "string" }, description: "Knowledge Outcome categories (Knowledge, Understanding, Application, Skills)." },
        learning_outcomes: { type: ["array", "null"], items: { type: "string" }, description: "Learning outcome statements covered by this question." },
      },
      required: ["stem", "answer", "mark_scheme", "difficulty"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Free-trial mode: no auth required. Use service role to bypass RLS.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { questionId, instruction, difficulty, target_ao_codes, target_kos, target_los } = await req.json();
    const targetDifficulty: "easy" | "medium" | "hard" | null =
      difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : null;

    const targetAOs: string[] | null = Array.isArray(target_ao_codes) && target_ao_codes.length > 0 ? target_ao_codes : null;
    const targetKOs: string[] | null = Array.isArray(target_kos) && target_kos.length > 0 ? target_kos : null;
    const targetLOs: string[] | null = Array.isArray(target_los) && target_los.length > 0 ? target_los : null;

    const { data: q, error: qErr } = await supabase
      .from("assessment_questions")
      .select("*, assessments(subject, level, title)")
      .eq("id", questionId)
      .single();

    if (qErr || !q) return new Response(JSON.stringify({ error: "Question not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const a: any = q.assessments;

    const sys = `You are an expert Singapore MOE assessment writer for ${a?.level} ${a?.subject}. Use British spelling, SI units, Singapore contexts. Match MOE phrasing.`;
    const difficultyDirective = targetDifficulty
      ? `\nTarget difficulty: ${targetDifficulty}. Calibrate stem complexity, distractor closeness, and required reasoning steps to match a typical MOE ${targetDifficulty} item. The returned difficulty MUST be exactly "${targetDifficulty}".`
      : "";

    const objectivesBlock: string[] = [];
    if (targetAOs) objectivesBlock.push(`Target Assessment Objectives (the question MUST address ALL of these): ${targetAOs.join(", ")}. Return ao_codes containing exactly these.`);
    if (targetKOs) objectivesBlock.push(`Target Knowledge Outcomes (the question MUST exercise ALL of these): ${targetKOs.join(", ")}. Return knowledge_outcomes containing exactly these.`);
    if (targetLOs) objectivesBlock.push(`Target Learning Outcomes (the question MUST cover ALL of these): ${targetLOs.map((lo) => `• ${lo}`).join(" ")}. Return learning_outcomes containing exactly these statements.`);
    const objectivesDirective = objectivesBlock.length > 0 ? `\n${objectivesBlock.join("\n")}` : `\nReturn ao_codes, knowledge_outcomes and learning_outcomes accurately reflecting what the question actually addresses.`;

    const user = `Rewrite the following question. Keep its question_type (${q.question_type}), topic (${q.topic}), Bloom's level (${q.bloom_level}), and marks (${q.marks}).
Original stem: ${q.stem}
${instruction ? `Teacher instruction: ${instruction}` : "Make it a fresh, equivalent alternative."}${difficultyDirective}${objectivesDirective}
Return via the tool.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "rewrite_question" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI err", t);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: t }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiResp.json();
    const tc = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) return new Response(JSON.stringify({ error: "No structured response" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const updated = JSON.parse(tc.function.arguments);

    // Force the saved row to use the targets when supplied; otherwise honour
    // the model's emitted arrays (or fall back to existing values).
    const finalAOs = targetAOs ?? (Array.isArray(updated.ao_codes) ? updated.ao_codes : (q.ao_codes ?? []));
    const finalKOs = targetKOs ?? (Array.isArray(updated.knowledge_outcomes) ? updated.knowledge_outcomes : (q.knowledge_outcomes ?? []));
    const finalLOs = targetLOs ?? (Array.isArray(updated.learning_outcomes) ? updated.learning_outcomes : (q.learning_outcomes ?? []));

    const patch = {
      stem: updated.stem,
      options: updated.options ?? q.options,
      answer: updated.answer,
      mark_scheme: updated.mark_scheme,
      difficulty: targetDifficulty ?? updated.difficulty,
      ao_codes: finalAOs,
      knowledge_outcomes: finalKOs,
      learning_outcomes: finalLOs,
    };

    const { error: upErr } = await supabase.from("assessment_questions").update(patch).eq("id", questionId);
    if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ ok: true, question: patch }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
