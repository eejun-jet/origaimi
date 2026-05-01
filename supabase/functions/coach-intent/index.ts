// Assessment Intent Coach — pre-generation pass.
//
// Receives the assessment-builder snapshot (subject, level, AOs, sections,
// special instructions) and returns 1–2 high-leverage observations plus
// optional one-line suggestions. The system prompt is the "Assessment Intent
// Coach" brief: sparse, optional, no jargon, never blocks the teacher.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const INTENT_TOOL = {
  type: "function",
  function: {
    name: "submit_intent_review",
    description: "Submit the pre-generation Assessment Intent Coach review.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Optional, 1 sentence headline. Empty if nothing to flag." },
        observations: {
          type: "array",
          description: "At most 3 short observations. Empty array if nothing meaningful to say.",
          items: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["info", "warn"] },
              category: {
                type: "string",
                enum: ["intent", "ao_balance", "cognitive_demand", "coverage", "context", "instructions"],
              },
              note: { type: "string", description: "One sentence, plain teacher language, British spelling." },
            },
            required: ["severity", "category", "note"],
            additionalProperties: false,
          },
        },
        suggestions: {
          type: "array",
          description: "At most 2 actionable one-liners. Empty array if not needed.",
          items: {
            type: "object",
            properties: {
              rewrite: { type: "string", description: "One concrete sentence the teacher can apply." },
              rationale: { type: "string" },
              target: { type: "string", enum: ["instructions", "sections", "general"] },
            },
            required: ["rewrite", "target"],
            additionalProperties: false,
          },
        },
      },
      required: ["observations", "suggestions"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `You are an Assessment Intent Coach embedded in an AI-powered assessment builder for Singapore MOE teachers, BEFORE the paper is generated.

Behave like an experienced instructional leader and thoughtful moderation partner. Do NOT behave like an inspector, a compliance checker, an academic lecturer, or a verbose chatbot. The teacher must feel respected, in control, and professionally supported — never judged, interrogated, or slowed down.

Your interventions must be sparse, high-value, contextual, actionable, and concise. SILENCE IS OFTEN BETTER THAN LOW-VALUE COMMENTARY. If the plan looks reasonable, return empty arrays — do not invent issues to look helpful.

Only intervene when:
- assessment intent is unclear,
- assessment quality may meaningfully suffer,
- syllabus alignment appears weak,
- cognitive demand is too narrow,
- question diversity is too low,
- assessment validity may be compromised.

Style:
- British spelling, Singapore phrasing, plain teacher language.
- At most 3 observations and 2 suggestions total.
- One sentence each. No Bloom's jargon, no construct-validity speak, no lectures.
- Suggestions must be optional and actionable. Prefer "Would you like…" or "Consider…" framings.
- Never contradict the user's stated paper structure or syllabus paper conventions. If a Paper 1 is by-design pure MCQ or a paper has a fixed format, do not suggest changing the format — focus on what genuinely improves quality within those constraints.
- Do not ask the teacher to fill forms or specify cognitive levels.

Examples of GOOD interventions:
- "This currently emphasises factual recall. The syllabus may support more data interpretation or reasoning."
- "Would you like one unfamiliar context question to improve transfer?"
- "Three topics selected, only one is being tested — intentional?"

Examples of BAD interventions (never do these):
- "Please specify the intended cognitive level."
- "Your assessment lacks construct validity."
- Generic praise like "Great job structuring this paper!"

Return STRICTLY through the submit_intent_review tool. If nothing meaningful to add, return empty observations and suggestions arrays — that is the correct, expected outcome a lot of the time.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const snapshot = await req.json().catch(() => null);
    if (!snapshot || typeof snapshot !== "object") {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPayload = `Review this assessment plan and submit findings via the tool.\n\n${JSON.stringify(snapshot)}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPayload },
        ],
        tools: [INTENT_TOOL],
        tool_choice: { type: "function", function: { name: "submit_intent_review" } },
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a minute." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Top up to continue." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error("coach-intent AI error:", aiResp.status, errTxt);
      return new Response(
        JSON.stringify({ error: "Coach is temporarily unavailable. Please retry." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("coach-intent: no tool call", JSON.stringify(aiJson).slice(0, 500));
      return new Response(JSON.stringify({ error: "Coach returned no findings — try again." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let findings: unknown;
    try {
      findings = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("coach-intent: bad tool args", e);
      return new Response(JSON.stringify({ error: "Coach output was malformed — try again." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ran_at: new Date().toISOString(), findings }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("coach-intent fatal:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
