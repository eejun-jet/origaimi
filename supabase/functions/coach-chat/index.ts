// Coach Chat — conversational mode for the Assessment Coach.
//
// Streams replies (SSE) grounded in the live builder snapshot so teachers
// can ask questions and brainstorm before (or after) generation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const BASE_PROMPT = `You are an Assessment Intent Coach embedded in an AI-powered assessment builder for Singapore MOE teachers. You are now in CHAT mode: the teacher wants to think out loud, ask questions, or brainstorm with you.

Behave like an experienced instructional leader and thoughtful moderation partner. Never an inspector, never a lecturer. The teacher must feel respected, in control, and professionally supported.

CHAT-MODE RULES
- Keep replies short. Default to ≤4 short paragraphs or ≤6 bullets. Never write essays.
- When the teacher asks for ideas, give 2–3 options, not a lecture.
- British spelling, Singapore phrasing, plain teacher language. No Bloom's jargon, no construct-validity speak.
- Ground answers in the builder snapshot below (subject, level, AOs, KOs/LOs, sections, special instructions, syllabus aims). Do not invent topic codes or syllabus content you cannot see.
- If the teacher asks something off-topic (not about assessment, this paper, or teaching practice), one polite line and steer back.
- You do NOT generate the paper. The teacher uses the Generate button for that. You help them think.
- You do NOT re-do the structured Review (that's a separate tab). Don't dump bulleted "observations" unprompted.

APPLY-TO-INSTRUCTIONS AFFORDANCE
When you propose a concrete one-line cue the teacher could drop into the paper's Special Instructions, wrap that line — and ONLY that line — in a fenced block tagged \`instruction\`:

\`\`\`instruction
Use Singapore-relevant contexts (e.g. HDB estates, hawker centres) where natural.
\`\`\`

Use this sparingly — only when the teacher asks for a cue, a context idea, or guardrails. One block per reply at most. The teacher will see an "Apply to instructions" button next to it.`;

function buildSystemPrompt(opts: {
  stage: "pre" | "post";
  snapshot: unknown;
  syllabusContext: string;
  postContext: string;
}) {
  const { stage, snapshot, syllabusContext, postContext } = opts;
  const stageNote = stage === "post"
    ? "STAGE: post-generation. The paper has already been drafted. Help the teacher critique, refine, or brainstorm next steps. Suggestions here are advisory — there is no apply-to-instructions button on this page."
    : "STAGE: pre-generation. The teacher is still shaping the paper plan. Help them think through balance, demand, context, and special instructions before they hit Generate.";

  return [
    BASE_PROMPT,
    "",
    stageNote,
    "",
    "BUILDER SNAPSHOT (JSON):",
    "```json",
    JSON.stringify(snapshot ?? {}, null, 2).slice(0, 8000),
    "```",
    syllabusContext,
    postContext,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null) as {
      stage?: "pre" | "post";
      snapshot?: unknown;
      assessment_id?: string | null;
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
    } | null;

    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stage: "pre" | "post" = body.stage === "post" ? "post" : "pre";
    const snapshot = body.snapshot ?? {};
    const syllabusDocId = (snapshot as { syllabus_doc_id?: string | null })?.syllabus_doc_id ?? null;

    let syllabusContext = "";
    let postContext = "";

    if (syllabusDocId || (stage === "post" && body.assessment_id)) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        if (syllabusDocId) {
          const { data: sd } = await supabase
            .from("syllabus_documents")
            .select("aims, assessment_rationale, pedagogical_notes, command_word_glossary")
            .eq("id", syllabusDocId)
            .maybeSingle();
          if (sd && (sd.aims || sd.assessment_rationale || sd.pedagogical_notes)) {
            const cw = Array.isArray(sd.command_word_glossary)
              ? (sd.command_word_glossary as Array<{ word: string; definition: string }>)
                  .slice(0, 8)
                  .map((g) => `${g.word}: ${g.definition}`)
                  .join("; ")
              : "";
            syllabusContext = [
              "\nSYLLABUS CONTEXT (use only to ground tone and intent):",
              sd.aims ? `Aims: ${sd.aims}` : "",
              sd.assessment_rationale ? `Assessment rationale: ${sd.assessment_rationale}` : "",
              sd.pedagogical_notes ? `Pedagogical notes: ${sd.pedagogical_notes}` : "",
              cw ? `Command words: ${cw}` : "",
            ].filter(Boolean).join("\n");
          }
        }

        if (stage === "post" && body.assessment_id) {
          const { data: a } = await supabase
            .from("assessments")
            .select("title, total_marks, duration_min, sections, questions")
            .eq("id", body.assessment_id)
            .maybeSingle();
          if (a) {
            const summary = {
              title: a.title,
              total_marks: a.total_marks,
              duration_min: a.duration_min,
              sections: a.sections,
              questions: Array.isArray(a.questions)
                ? (a.questions as Array<Record<string, unknown>>).map((q) => ({
                    number: q.number,
                    section: q.section,
                    type: q.type,
                    marks: q.marks,
                    ao_codes: q.ao_codes,
                    learning_outcomes: q.learning_outcomes,
                    stem: typeof q.stem === "string" ? (q.stem as string).slice(0, 400) : null,
                  }))
                : [],
            };
            postContext = "\nGENERATED PAPER SUMMARY:\n```json\n" +
              JSON.stringify(summary, null, 2).slice(0, 6000) + "\n```";
          }
        }
      } catch (e) {
        console.error("coach-chat: context fetch failed", e);
      }
    }

    const systemPrompt = buildSystemPrompt({ stage, snapshot, syllabusContext, postContext });

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...body.messages.slice(-12).map((m) => ({
        role: m.role,
        content: String(m.content ?? "").slice(0, 4000),
      })),
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        stream: true,
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
    if (!aiResp.ok || !aiResp.body) {
      const errTxt = await aiResp.text().catch(() => "");
      console.error("coach-chat AI error:", aiResp.status, errTxt);
      return new Response(JSON.stringify({ error: "Coach is temporarily unavailable. Please retry." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(aiResp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("coach-chat fatal:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
