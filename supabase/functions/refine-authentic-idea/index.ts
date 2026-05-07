// Refine a single authentic-idea in place per a teacher instruction.

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
    name: "submit_idea",
    description: "Return the refined idea.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        brief: { type: "string" },
        student_brief: { type: "string" },
        duration_minutes: { type: "integer" },
        group_size: { type: "string" },
        materials: { type: "array", items: { type: "string" } },
        ao_codes: { type: "array", items: { type: "string" } },
        teacher_notes: { type: "string" },
        rubric: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterion: { type: "string" },
              levels: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    descriptor: { type: "string" },
                  },
                  required: ["label", "descriptor"],
                  additionalProperties: false,
                },
              },
            },
            required: ["criterion", "levels"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "brief", "student_brief", "duration_minutes", "group_size", "rubric"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { idea_id, instruction } = await req.json();
    if (!idea_id || !instruction) {
      return new Response(JSON.stringify({ error: "idea_id and instruction required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: idea, error } = await supabase.from("authentic_ideas").select("*").eq("id", idea_id).single();
    if (error || !idea) {
      return new Response(JSON.stringify({ error: "Idea not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You refine a single authentic assessment idea per the teacher's instruction. Keep the same mode and intent. Singapore-relevant where natural, British spelling. Return strictly via submit_idea." },
          { role: "user", content: `CURRENT IDEA:\n${JSON.stringify(idea, null, 2)}\n\nTEACHER INSTRUCTION: ${instruction}` },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "submit_idea" } },
      }),
    });
    if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit reached." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!aiResp.ok) return new Response(JSON.stringify({ error: "Refine failed" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const aiJson = await aiResp.json();
    const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return new Response(JSON.stringify({ error: "No output" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const updated = JSON.parse(args);

    const { error: upErr } = await supabase.from("authentic_ideas").update({
      title: updated.title ?? idea.title,
      brief: updated.brief ?? idea.brief,
      student_brief: updated.student_brief ?? idea.student_brief,
      duration_minutes: updated.duration_minutes ?? idea.duration_minutes,
      group_size: updated.group_size ?? idea.group_size,
      materials: updated.materials ?? idea.materials,
      ao_codes: updated.ao_codes ?? idea.ao_codes,
      rubric: updated.rubric ?? idea.rubric,
      teacher_notes: updated.teacher_notes ?? idea.teacher_notes,
    }).eq("id", idea_id);
    if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
