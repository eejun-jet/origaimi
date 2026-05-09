// Assessment Intent Coach — pre-generation pass.
//
// Receives the assessment-builder snapshot (subject, level, AOs, sections,
// special instructions) and returns 1–2 high-leverage observations plus
// optional one-line suggestions. The system prompt is the "Assessment Intent
// Coach" brief: sparse, optional, no jargon, never blocks the teacher.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

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
                enum: [
                  "intent",
                  "ao_balance",
                  "cognitive_demand",
                  "coverage",
                  "context",
                  "instructions",
                  "pitch",
                  "style",
                ],
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

Only intervene when one of the following genuinely applies:
- ALIGNMENT: planned AO mix is materially off the syllabus weighting target (≥20pp delta), or KO bands the syllabus expects are missing.
- PITCH: difficulty is meaningfully under- or over-pitched for the level — judged against the syllabus level and the past-paper exemplars below (if provided).
- STYLE: command-word or stimulus variety is too narrow (e.g. all "state/describe", all text-only stems, no source/data work where the syllabus expects it).
- COVERAGE: many topics or LOs selected, but only a small slice is exercised.
- CONTEXT: a single context cue would clearly lift authenticity (Singapore setting, transfer scenario, source extract).
- INTENT: the stated assessment goal does not match the structure (e.g. "diagnostic" but only summative-style stems).

Categories: use one of intent | ao_balance | cognitive_demand | coverage | context | instructions | pitch | style.

Style:
- British spelling, Singapore phrasing, plain teacher language.
- At most 3 observations and 2 suggestions total.
- One sentence each. No Bloom's jargon, no construct-validity speak, no lectures.
- Be SPECIFIC: name the AO/KO/section/command word you are flagging. "Plan is ~72% AO‑A vs target ~50%" beats "AO balance looks off".
- Suggestions must be optional and actionable. Prefer "Would you like…" or "Consider…" framings.
- Never contradict the user's stated paper structure or syllabus paper conventions. If a Paper 1 is by-design pure MCQ or a paper has a fixed format, do not suggest changing the format — focus on what genuinely improves quality within those constraints.
- Do not ask the teacher to fill forms or specify cognitive levels.

Examples of GOOD interventions:
- "Plan is ~72% AO‑A vs syllabus target ~50% — consider shifting one structured item to AO‑B."
- "Five of six stems are 'state' or 'describe'; one 'evaluate' or 'compare' would broaden demand."
- "Average mark per question is 1.2 — pitches lighter than typical at O‑Level. A 6–8 mark structured item would calibrate it."
- "No source-based item, but AO‑B for SS expects source skills (infer, compare, assess utility)."

Examples of BAD interventions (never do these):
- "Please specify the intended cognitive level."
- "Your assessment lacks construct validity."
- Generic praise like "Great job structuring this paper!"
- Vague AO comments without naming the AO and the delta.

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

    let syllabusContext = "";
    const syllabusDocId = (snapshot as { syllabus_doc_id?: string | null })?.syllabus_doc_id ?? null;
    const subjectStr = (snapshot as { subject?: string | null })?.subject ?? null;
    const levelStr = (snapshot as { level?: string | null })?.level ?? null;

    if (syllabusDocId) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        const [sdRes, aoRes, koRes, exRes] = await Promise.all([
          supabase
            .from("syllabus_documents")
            .select("aims, assessment_rationale, pedagogical_notes, command_word_glossary")
            .eq("id", syllabusDocId)
            .maybeSingle(),
          supabase
            .from("syllabus_assessment_objectives")
            .select("code, title, weighting_percent, description")
            .eq("source_doc_id", syllabusDocId)
            .order("position", { ascending: true }),
          supabase
            .from("syllabus_topics")
            .select("outcome_categories")
            .eq("source_doc_id", syllabusDocId)
            .limit(200),
          supabase
            .from("question_bank_items")
            .select("command_word, marks, stem, ao_codes")
            .eq("syllabus_doc_id", syllabusDocId)
            .order("created_at", { ascending: false })
            .limit(8),
        ]);

        const sd = sdRes.data as {
          aims?: string | null;
          assessment_rationale?: string | null;
          pedagogical_notes?: string | null;
          command_word_glossary?: Array<{ word: string; definition: string }> | null;
        } | null;

        const aos = (aoRes.data ?? []) as Array<{
          code: string; title: string | null; weighting_percent: number | null; description: string | null;
        }>;

        const koBands = new Set<string>();
        for (const row of (koRes.data ?? []) as Array<{ outcome_categories: string[] | null }>) {
          for (const c of row.outcome_categories ?? []) if (c) koBands.add(c);
        }

        const exemplars = ((exRes.data ?? []) as Array<{
          command_word: string | null; marks: number | null; stem: string | null; ao_codes: string[] | null;
        }>)
          .filter((q) => q.stem && q.stem.length > 30)
          .slice(0, 5)
          .map((q, i) =>
            `  ${i + 1}. [${q.command_word ?? "—"} · ${q.marks ?? "?"}m · ${(q.ao_codes ?? []).join("/") || "—"}] ${(q.stem ?? "").slice(0, 220).replace(/\s+/g, " ").trim()}`,
          )
          .join("\n");

        const cw = Array.isArray(sd?.command_word_glossary)
          ? sd!.command_word_glossary!
              .slice(0, 12)
              .map((g) => `${g.word}: ${g.definition}`)
              .join("; ")
          : "";

        const aoTable = aos.length > 0
          ? aos.map((a) =>
              `  - ${a.code}${a.title ? ` (${a.title})` : ""}: target ~${a.weighting_percent ?? "—"}%${a.description ? ` — ${a.description.slice(0, 160)}` : ""}`,
            ).join("\n")
          : "";

        const koList = koBands.size > 0 ? Array.from(koBands).slice(0, 12).join(", ") : "";

        if (sd || aos.length > 0 || koBands.size > 0 || exemplars) {
          syllabusContext = [
            "\n\nSYLLABUS CONTEXT (use to ground alignment, pitch, and style — do not invent topic codes):",
            sd?.aims ? `Aims: ${sd.aims}` : "",
            sd?.assessment_rationale ? `Assessment rationale: ${sd.assessment_rationale}` : "",
            sd?.pedagogical_notes ? `Pedagogical notes: ${sd.pedagogical_notes}` : "",
            aoTable ? `AO weighting targets:\n${aoTable}` : "",
            koList ? `KO bands available: ${koList}` : "",
            cw ? `Command word glossary: ${cw}` : "",
            exemplars ? `\nPAST-PAPER EXEMPLARS for this syllabus${levelStr ? ` (${levelStr}${subjectStr ? `, ${subjectStr}` : ""})` : ""} — use to calibrate pitch and style:\n${exemplars}` : "",
          ].filter(Boolean).join("\n");
        }
      } catch (e) {
        console.error("coach-intent: syllabus context fetch failed", e);
      }
    }

    const userPayload = `Review this assessment plan and submit findings via the tool.\n\n${JSON.stringify(snapshot)}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT + syllabusContext },
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
