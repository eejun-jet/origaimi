// Refine a single authentic-idea in place per a teacher instruction.
//
// Tool schema is intentionally simple — deep-nested rubric / required /
// additionalProperties combinations have been observed to trigger the AI
// gateway's "specified schema produces too many states" 400 on this model
// family. We mirror the simplified shape used by `generate-authentic-ideas`,
// and fall back to JSON-mode if the tool call returns nothing.

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
        student_brief: { type: "string", description: "Student-facing brief. If a worksheet/scaffold is requested, append it here under a '## Worksheet / Scaffold' heading with numbered preparation questions." },
        duration_minutes: { type: "integer" },
        group_size: { type: "string" },
        materials: { type: "array", items: { type: "string" } },
        ao_codes: { type: "array", items: { type: "string" } },
        teacher_notes: { type: "string" },
        milestones: {
          type: "array",
          description: "Session-by-session timeline. 'when' is a short label like 'Lesson 1 (1h)' or 'Week 2'.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              when: { type: "string" },
              description: { type: "string" },
            },
            required: ["label", "when"],
          },
        },
        rubric: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterion: { type: "string" },
              levels: { type: "array", items: { type: "string" } },
            },
            required: ["criterion", "levels"],
          },
        },
      },
      required: ["title", "brief"],
    },
  },
};

const SYS = "You refine a single authentic assessment idea per the teacher's instruction. Keep the same mode and intent. Honour explicit teacher requests for worksheets, scaffolds, timelines, and total class time — do not silently drop these. When a worksheet is requested, embed it inside `student_brief` under a '## Worksheet / Scaffold' heading with numbered preparation questions students should answer before the task. When a timeline is requested, populate `milestones` (one entry per session) and update `duration_minutes` to match the total. Singapore-relevant where natural, British spelling. Return strictly via the submit_idea tool.";

type Idea = Record<string, unknown>;

async function callAI(idea: Idea, instruction: string, useTool: boolean) {
  const body: Record<string, unknown> = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: `CURRENT IDEA:\n${JSON.stringify(idea, null, 2)}\n\nTEACHER INSTRUCTION: ${instruction}` },
    ],
  };
  if (useTool) {
    body.tools = [TOOL];
    body.tool_choice = { type: "function", function: { name: "submit_idea" } };
  } else {
    body.response_format = { type: "json_object" };
    body.messages = [
      { role: "system", content: SYS + "\n\nReturn a single JSON object with keys: title, brief, student_brief, duration_minutes, group_size, materials, ao_codes, teacher_notes, milestones (array of {label, when, description}), rubric (array of {criterion, levels: string[]})." },
      (body.messages as Array<{role:string;content:string}>)[1],
    ];
  }
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { idea_id, instruction } = await req.json();
    if (!idea_id || !instruction) return jsonError(400, "idea_id and instruction required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: idea, error } = await supabase.from("authentic_ideas").select("*").eq("id", idea_id).single();
    if (error || !idea) return jsonError(404, "Idea not found");

    let updated: Record<string, unknown> | null = null;

    // Attempt 1: tool call.
    let aiResp = await callAI(idea, instruction, true);
    if (aiResp.status === 429) return jsonError(429, "Rate limit reached.");
    if (aiResp.status === 402) return jsonError(402, "AI credits exhausted.");
    if (aiResp.ok) {
      const aiJson = await aiResp.json();
      const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (args) {
        try { updated = JSON.parse(args); } catch (e) { console.warn("tool args parse failed:", (e as Error).message); }
      } else {
        console.warn("refine: no tool_calls in response, will retry in JSON mode");
      }
    } else {
      const t = await aiResp.text().catch(() => "");
      console.warn(`refine: tool-mode gateway ${aiResp.status}: ${t.slice(0, 300)}`);
    }

    // Attempt 2: JSON mode fallback.
    if (!updated) {
      aiResp = await callAI(idea, instruction, false);
      if (aiResp.status === 429) return jsonError(429, "Rate limit reached.");
      if (aiResp.status === 402) return jsonError(402, "AI credits exhausted.");
      if (!aiResp.ok) {
        const t = await aiResp.text().catch(() => "");
        return jsonError(502, `Refine failed: ${aiResp.status} ${t.slice(0, 200)}`);
      }
      const aiJson = await aiResp.json();
      const content = aiJson?.choices?.[0]?.message?.content;
      if (!content) return jsonError(502, "Refine returned no output");
      try { updated = JSON.parse(content); } catch {
        // Strip ```json fences if present.
        const m = String(content).match(/\{[\s\S]*\}/);
        if (m) { try { updated = JSON.parse(m[0]); } catch (e) { console.warn("json fallback parse failed:", (e as Error).message); } }
      }
      if (!updated) return jsonError(502, "Refine returned unparseable output");
    }

    const u = updated as Record<string, unknown>;
    const milestones = Array.isArray(u.milestones) ? u.milestones : (idea as Idea).milestones;
    const rubric = Array.isArray(u.rubric) ? u.rubric : (idea as Idea).rubric;

    const { error: upErr } = await supabase.from("authentic_ideas").update({
      title: u.title ?? (idea as Idea).title,
      brief: u.brief ?? (idea as Idea).brief,
      student_brief: u.student_brief ?? (idea as Idea).student_brief,
      duration_minutes: u.duration_minutes ?? (idea as Idea).duration_minutes,
      group_size: u.group_size ?? (idea as Idea).group_size,
      materials: u.materials ?? (idea as Idea).materials,
      ao_codes: u.ao_codes ?? (idea as Idea).ao_codes,
      rubric,
      milestones,
      teacher_notes: u.teacher_notes ?? (idea as Idea).teacher_notes,
    }).eq("id", idea_id);
    if (upErr) return jsonError(500, upErr.message);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("refine-authentic-idea error:", e);
    return jsonError(500, e instanceof Error ? e.message : "Unknown error");
  }
});
