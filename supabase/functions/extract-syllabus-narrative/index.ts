// Narrative-only re-parse of a syllabus PDF.
// Extracts aims, assessment rationale, pedagogical notes, and command-word
// glossary into syllabus_documents — leaves AOs/KOs/LOs/SOs untouched.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `You are an experienced Singapore MOE curriculum analyst.

Your task is to extract the NARRATIVE / pedagogical context of a syllabus document — NOT its topic list, learning outcomes, or assessment objectives table (those have already been ingested separately).

Capture, verbatim where possible:
- aims: the stated syllabus aims and goals (often "Aims" or "The syllabus aims to..."). Concatenate bullet points into a single readable paragraph or short list.
- assessment_rationale: what the assessment is designed to measure and why — pulled from sections like "Scheme of Assessment", "Rationale", "Approach to Assessment", "Assessment philosophy", or any prose that explains the *intent* behind the paper structure (not just the marks/duration table).
- pedagogical_notes: teaching/learning approach, inquiry framing, skills emphasis, values, citizenship aims, IBL (inquiry-based learning) framing, source-based skills, Historical/Geographical/Social inquiry phrases — whatever the syllabus says about HOW the subject should be taught and what dispositions are expected.
- command_word_glossary: if the syllabus contains a glossary / definitions of command words (e.g. "Describe", "Explain", "Compare", "Assess", "To what extent…"), extract each as { word, definition } verbatim. If absent, return an empty array.

Rules:
- Preserve British spelling and the syllabus's own phrasing.
- Do NOT invent content. If a section is absent, return an empty string (or empty array for the glossary).
- Keep each text field under ~2000 characters; summarise faithfully if longer.`;

const TOOL = {
  type: "function",
  function: {
    name: "save_narrative",
    description: "Save the extracted syllabus narrative context.",
    parameters: {
      type: "object",
      properties: {
        aims: { type: "string" },
        assessment_rationale: { type: "string" },
        pedagogical_notes: { type: "string" },
        command_word_glossary: {
          type: "array",
          items: {
            type: "object",
            properties: {
              word: { type: "string" },
              definition: { type: "string" },
            },
            required: ["word", "definition"],
            additionalProperties: false,
          },
        },
      },
      required: ["aims", "assessment_rationale", "pedagogical_notes", "command_word_glossary"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { documentId, filePath } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: doc, error: docErr } = await supabase
      .from("syllabus_documents")
      .select("id, title, subject, level, file_path")
      .eq("id", documentId)
      .single();
    if (docErr || !doc) throw new Error(`Document not found: ${docErr?.message}`);

    const path = filePath || doc.file_path;
    const { data: blob, error: dlErr } = await supabase.storage.from("syllabi").download(path);
    if (dlErr || !blob) throw new Error(`Download failed (${path}): ${dlErr?.message}`);

    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);

    const userMessage = {
      role: "user",
      content: [
        { type: "text", text: `Extract the narrative context from this syllabus.\n\nTitle: "${doc.title}"\nSubject: ${doc.subject ?? "unknown"}\nLevel: ${doc.level ?? "unknown"}` },
        { type: "image_url", image_url: { url: `data:application/pdf;base64,${b64}` } },
      ],
    };

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          userMessage,
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "save_narrative" } },
      }),
    });

    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      const status = aiResp.status === 429 ? 429 : aiResp.status === 402 ? 402 : 500;
      return new Response(JSON.stringify({ error: "AI failed", status: aiResp.status, details: errTxt.slice(0, 800) }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No structured output", raw: aiJson }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const args = JSON.parse(toolCall.function.arguments);

    const { error: upErr } = await supabase.from("syllabus_documents").update({
      aims: args.aims ?? null,
      assessment_rationale: args.assessment_rationale ?? null,
      pedagogical_notes: args.pedagogical_notes ?? null,
      command_word_glossary: Array.isArray(args.command_word_glossary) ? args.command_word_glossary : [],
      narrative_source_path: path,
    }).eq("id", documentId);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      ok: true,
      documentId,
      aims_chars: (args.aims ?? "").length,
      rationale_chars: (args.assessment_rationale ?? "").length,
      pedagogy_chars: (args.pedagogical_notes ?? "").length,
      command_words: (args.command_word_glossary ?? []).length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
