import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { buildRegenerateDifficultyDirective } from "../_shared/difficulty.ts";

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
      ? buildRegenerateDifficultyDirective(targetDifficulty, q.difficulty ?? null, q.question_type)
      : "";

    const objectivesBlock: string[] = [];
    if (targetAOs) objectivesBlock.push(`Target Assessment Objectives (the question MUST address ALL of these): ${targetAOs.join(", ")}. Return ao_codes containing exactly these.`);
    if (targetKOs) objectivesBlock.push(`Target Knowledge Outcomes (the question MUST exercise ALL of these): ${targetKOs.join(", ")}. Return knowledge_outcomes containing exactly these.`);
    if (targetLOs) objectivesBlock.push(`Target Learning Outcomes (the question MUST cover ALL of these): ${targetLOs.map((lo) => `• ${lo}`).join(" ")}. Return learning_outcomes containing exactly these statements.`);
    const objectivesDirective = objectivesBlock.length > 0 ? `\n${objectivesBlock.join("\n")}` : `\nReturn ao_codes, knowledge_outcomes and learning_outcomes accurately reflecting what the question actually addresses.`;

    // For SBQs, infer the underlying skill from the existing stem and inject
    // a directive that the answer field MUST be a fully-written L4 candidate
    // exemplar that performs the LORMS L4 moves of that skill.
    let sbqDirective = "";
    if (q.question_type === "source_based") {
      const stemLc = String(q.stem ?? "").toLowerCase();
      let skill = "inference";
      if (/how far do sources?\s+[a-f].*support this assertion/.test(stemLc)) skill = "assertion";
      else if (/\bcompare\b|how (similar|different)|how far are sources/.test(stemLc)) skill = "comparison";
      else if (/\b(reliab|trust|accurate)\b/.test(stemLc)) skill = "reliability";
      else if (/\b(useful|utility)\b/.test(stemLc)) skill = "utility";
      else if (/\b(purpose|why was source|would.*have agreed)\b/.test(stemLc)) skill = "purpose";
      else if (/\bsurprised\b/.test(stemLc)) skill = "surprise";

      const skillL4: Record<string, string> = {
        inference: `INFERENCE L4: 2 distinct supported inferences (about attitudes / motives / perspectives — NOT recall), each with a SHORT verbatim quotation from the source, plus a one-sentence reasoned overall conclusion.`,
        purpose: `PURPOSE L4: state a specific purpose; justify with BOTH provenance (author, audience, date, context) AND specific content evidence (quoted phrases) AND contextual knowledge.`,
        comparison: `COMPARISON L4: identify BOTH a similarity AND a difference in MESSAGE (each with a quoted phrase from EACH source); compare TONE / PROVENANCE; reach a reasoned overall judgement on similarity.`,
        utility: `UTILITY L4: evaluate using CONTENT (quoted evidence) AND PROVENANCE (author/audience/date/type), explicitly acknowledge LIMITATIONS (what the source cannot show), reach a reasoned overall judgement.`,
        reliability: `RELIABILITY L4: CROSS-REFERENCE specific claims against contextual knowledge; analyse PROVENANCE; analyse BIAS / MOTIVE (loaded language, omissions); reach a balanced reasoned judgement.`,
        surprise: `SURPRISE L4: explain BOTH what is surprising AND what is not, each anchored in BOTH source detail AND contextual knowledge; reach a reasoned balanced judgement.`,
        assertion: `ASSERTION L4: use EVERY source; group SUPPORT and CHALLENGE (each with a short quoted detail); weigh PROVENANCE / BIAS across the set; reach a substantiated overall judgement.`,
      };
      sbqDirective = `\n\nThis is a SOURCE-BASED QUESTION. The "answer" field MUST be a fully-written L4 candidate exemplar (continuous prose paragraphs, in the candidate's voice — NEVER "a strong answer would…" or "the candidate should…"). It must perform the L4 moves of the assigned skill: ${skillL4[skill]} Quote SHORT verbatim phrases from the source(s) named in the stem. Length: ~150–250 words for 5–6 mark parts, ~250–400 words for 7–8 mark parts.`;
    }

    const invariantsLine = targetDifficulty
      ? `Keep its question_type (${q.question_type}), topic (${q.topic}), and marks (${q.marks}). Bloom's level (was ${q.bloom_level}) MAY shift to match the target difficulty — do not force it to stay the same.`
      : `Keep its question_type (${q.question_type}), topic (${q.topic}), Bloom's level (${q.bloom_level}), and marks (${q.marks}).`;

    const user = `Rewrite the following question. ${invariantsLine}
Original stem: ${q.stem}
${instruction ? `Teacher instruction: ${instruction}` : "Make it a fresh, equivalent alternative."}${difficultyDirective}${objectivesDirective}${sbqDirective}
Return via the tool.`;


    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: targetDifficulty ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash",
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
