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

    const { questionId, instruction, difficulty } = await req.json();
    const targetDifficulty: "easy" | "medium" | "hard" | null =
      difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : null;

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
    const user = `Rewrite the following question. Keep its question_type (${q.question_type}), topic (${q.topic}), Bloom's level (${q.bloom_level}), and marks (${q.marks}).
Original stem: ${q.stem}
${instruction ? `Teacher instruction: ${instruction}` : "Make it a fresh, equivalent alternative."}${difficultyDirective}
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

    const patch = {
      stem: updated.stem,
      options: updated.options ?? q.options,
      answer: updated.answer,
      mark_scheme: updated.mark_scheme,
      difficulty: targetDifficulty ?? updated.difficulty,
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
