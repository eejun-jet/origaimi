// Generate a portfolio of authentic assessment ideas.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const ALLOWED_MODES = new Set([
  "mini_test", "performance_task", "project", "oral", "written_authentic", "self_peer",
]);

// Simpler schema — no enums, no min/max, no additionalProperties, fewer required.
const TOOL = {
  type: "function",
  function: {
    name: "submit_ideas",
    description: "Submit a balanced portfolio of assessment ideas.",
    parameters: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mode: { type: "string", description: "One of: mini_test, performance_task, project, oral, written_authentic, self_peer." },
              title: { type: "string" },
              brief: { type: "string" },
              student_brief: { type: "string" },
              duration_minutes: { type: "integer" },
              group_size: { type: "string" },
              ao_codes: { type: "array", items: { type: "string" } },
              knowledge_outcomes: { type: "array", items: { type: "string" } },
              learning_outcomes: { type: "array", items: { type: "string" } },
              materials: { type: "array", items: { type: "string" } },
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
              milestones: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    when: { type: "string" },
                  },
                  required: ["label", "when"],
                },
              },
              teacher_notes: { type: "string" },
            },
            required: ["mode", "title", "brief"],
          },
        },
      },
      required: ["ideas"],
    },
  },
};

const SYSTEM = `You are an Assessment Design Coach for Singapore MOE teachers, helping them design AUTHENTIC, BALANCED assessment portfolios that go beyond year-end exam papers.

Given a unit / scheme of work, propose 5–8 ideas across at least 4 of these modes:
- mini_test: 10–25 min low-stakes formative checks
- performance_task: short authentic task in a real-world context (lab investigation, data brief, design challenge, fieldwork write-up)
- project: multi-lesson, often group, with milestones
- oral: pitch, viva, debate, presentation, gallery walk
- written_authentic: letter, op-ed, source-based memo, infographic copy
- self_peer: structured self- or peer-assessment moment

Use ONLY these mode strings: mini_test, performance_task, project, oral, written_authentic, self_peer.

Rules:
- Cover MULTIPLE modes; never return just mini-tests.
- Tag each idea with the AO codes from the syllabus context provided. Use the EXACT codes given (e.g. "AO1", "AO2", "AO3").
- Use Singapore-relevant authentic contexts (HDB, hawker, MRT, NEA, PUB, local industries, local news) when natural — but for Social Studies a global case is fine.
- Be concrete: students should know exactly what to produce.
- Rubric: 3–5 criteria, each with 3–4 short level descriptors as plain strings (e.g. "Beginning: ...", "Proficient: ...").
- Respect class size, duration_weeks, and any constraints.
- British spelling, plain teacher language.
Return strictly through the submit_ideas tool.`;

const JSON_SYSTEM = SYSTEM + `

Return JSON of shape: { "ideas": [ { mode, title, brief, student_brief, duration_minutes, group_size, ao_codes:[], knowledge_outcomes:[], learning_outcomes:[], materials:[], rubric:[{criterion, levels:[]}], milestones:[{label, when}], teacher_notes } ] }`;

async function callTool(body: unknown) {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { plan_id } = await req.json();
    if (!plan_id) {
      return new Response(JSON.stringify({ error: "plan_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: plan, error: planErr } = await supabase
      .from("authentic_plans").select("*").eq("id", plan_id).single();
    if (planErr || !plan) {
      return new Response(JSON.stringify({ error: planErr?.message ?? "Plan not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let aoLines: string[] = [];
    let koLines: string[] = [];
    if (plan.syllabus_doc_id) {
      const [{ data: aos }, { data: topics }] = await Promise.all([
        supabase.from("syllabus_assessment_objectives")
          .select("code,title,description,weighting_percent")
          .eq("source_doc_id", plan.syllabus_doc_id)
          .order("position"),
        supabase.from("syllabus_topics")
          .select("strand,sub_strand,title,learning_outcomes")
          .eq("source_doc_id", plan.syllabus_doc_id)
          .limit(120),
      ]);
      aoLines = (aos ?? []).map((a) =>
        `${a.code} (${a.weighting_percent ?? "?"}%): ${a.title ?? ""} — ${a.description ?? ""}`.trim(),
      );
      const koSet = new Map<string, string[]>();
      for (const t of topics ?? []) {
        const ko = (t.strand ?? t.title ?? "").trim();
        if (!ko) continue;
        const los = Array.isArray(t.learning_outcomes) ? (t.learning_outcomes as string[]) : [];
        const arr = koSet.get(ko) ?? [];
        for (const lo of los.slice(0, 3)) if (!arr.includes(lo)) arr.push(lo);
        koSet.set(ko, arr);
      }
      koLines = Array.from(koSet.entries()).slice(0, 40).map(([ko, los]) =>
        `• ${ko}${los.length ? ` — e.g. ${los.slice(0, 2).join("; ")}` : ""}`,
      );
    }

    const userPayload = `UNIT TITLE: ${plan.title}
SUBJECT: ${plan.subject ?? "?"} · LEVEL: ${plan.level ?? "?"}
UNIT FOCUS: ${plan.unit_focus ?? "(not specified)"}
DURATION: ${plan.duration_weeks ?? "?"} weeks · CLASS SIZE: ${plan.class_size ?? "?"}
TEACHER GOALS: ${plan.goals ?? "(none)"}
CONSTRAINTS: ${plan.constraints ?? "(none)"}
PORTFOLIO MIX PREFERENCES: ${(plan.mix_preferences ?? []).join(", ") || "(balanced)"}

SCHEME OF WORK / NOTES:
${(plan.sow_text ?? "(none provided)").slice(0, 8000)}

SYLLABUS ASSESSMENT OBJECTIVES:
${aoLines.join("\n") || "(none)"}

SYLLABUS KNOWLEDGE OUTCOMES (selected):
${koLines.join("\n") || "(none)"}

Return 5–8 balanced ideas spanning at least 4 modes.`;

    const recordFailure = async (msg: string) => {
      await supabase.from("authentic_plans")
        .update({ status: "failed", notes: msg.slice(0, 1000) })
        .eq("id", plan_id);
    };

    // Attempt 1: tool call.
    let parsed: { ideas: Array<Record<string, unknown>> } | null = null;
    let lastErr = "";

    try {
      const aiResp = await callTool({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPayload },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "submit_ideas" } },
      });
      if (aiResp.status === 429) {
        await recordFailure("Rate limit reached.");
        return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a minute." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiResp.status === 402) {
        await recordFailure("AI credits exhausted.");
        return new Response(JSON.stringify({ error: "AI credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiResp.ok) {
        const aiJson = await aiResp.json();
        const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (args) {
          try { parsed = JSON.parse(args); } catch { lastErr = "tool args not JSON"; }
        } else {
          lastErr = "no tool call in response";
        }
      } else {
        lastErr = `tool path ${aiResp.status}: ${(await aiResp.text()).slice(0, 300)}`;
        console.error("generate-authentic-ideas tool error:", lastErr);
      }
    } catch (e) {
      lastErr = `tool path threw: ${e instanceof Error ? e.message : "unknown"}`;
    }

    // Attempt 2: plain JSON mode fallback.
    if (!parsed) {
      try {
        const aiResp2 = await callTool({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: JSON_SYSTEM },
            { role: "user", content: userPayload },
          ],
          response_format: { type: "json_object" },
        });
        if (!aiResp2.ok) {
          const txt = await aiResp2.text();
          lastErr = `json path ${aiResp2.status}: ${txt.slice(0, 300)}`;
          console.error("generate-authentic-ideas json error:", lastErr);
        } else {
          const j = await aiResp2.json();
          const content = j?.choices?.[0]?.message?.content ?? "";
          try { parsed = JSON.parse(content); } catch { lastErr = "json content not JSON: " + content.slice(0, 200); }
        }
      } catch (e) {
        lastErr = `json path threw: ${e instanceof Error ? e.message : "unknown"}`;
      }
    }

    if (!parsed || !Array.isArray(parsed.ideas) || parsed.ideas.length === 0) {
      await recordFailure(`Generation failed: ${lastErr || "no ideas returned"}`);
      return new Response(JSON.stringify({ error: `Generation failed: ${lastErr || "no ideas returned"}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Replace previous "suggested" ideas; keep saved ones.
    await supabase.from("authentic_ideas").delete()
      .eq("plan_id", plan_id).eq("status", "suggested");

    const rows = parsed.ideas.map((i, idx) => {
      const mode = String(i.mode ?? "performance_task");
      return {
        plan_id,
        position: idx,
        mode: ALLOWED_MODES.has(mode) ? mode : "performance_task",
        title: String(i.title ?? "Untitled"),
        brief: String(i.brief ?? ""),
        student_brief: String(i.student_brief ?? ""),
        duration_minutes: Number(i.duration_minutes ?? 0) || null,
        group_size: String(i.group_size ?? "individual"),
        ao_codes: Array.isArray(i.ao_codes) ? i.ao_codes : [],
        knowledge_outcomes: Array.isArray(i.knowledge_outcomes) ? i.knowledge_outcomes : [],
        learning_outcomes: Array.isArray(i.learning_outcomes) ? i.learning_outcomes : [],
        materials: Array.isArray(i.materials) ? i.materials : [],
        rubric: Array.isArray(i.rubric) ? i.rubric : [],
        milestones: Array.isArray(i.milestones) ? i.milestones : [],
        teacher_notes: String(i.teacher_notes ?? ""),
        status: "suggested",
      };
    });

    if (rows.length) {
      const { error: insErr } = await supabase.from("authentic_ideas").insert(rows);
      if (insErr) {
        console.error("insert ideas failed:", insErr);
        await recordFailure(`Insert failed: ${insErr.message}`);
        return new Response(JSON.stringify({ error: insErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    await supabase.from("authentic_plans")
      .update({ status: "ready", notes: null }).eq("id", plan_id);

    return new Response(JSON.stringify({ ok: true, count: rows.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-authentic-ideas fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
