// Parse an uploaded past paper PDF: extract per-page text and detect figures with captions.
// Stores diagram crops as separate uploads in the `diagrams` bucket and indexes them.
//
// This is intentionally lightweight — Gemini multimodal is asked to identify figure
// captions and topic tags page-by-page, but we DO NOT crop the image (cropping in a
// Worker runtime requires native libs we don't have). Instead, we save the full page
// rendering as the "diagram" and let the diagram cascade attribute it correctly.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `You are an exam-paper analyst. Given the rendered pages of a past exam paper PDF,
extract for each page:
- a list of figures present (caption text verbatim if printed, or a short generated caption)
- topic tags (lowercase keywords) for each figure based on the question context around it
Return ONLY via the save_paper_index tool.`;

const TOOL = {
  type: "function",
  function: {
    name: "save_paper_index",
    description: "Save the structured index of a past paper.",
    parameters: {
      type: "object",
      properties: {
        page_count: { type: "integer" },
        figures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              page_number: { type: "integer", minimum: 1 },
              caption: { type: "string" },
              topic_tags: { type: "array", items: { type: "string" } },
            },
            required: ["page_number", "caption", "topic_tags"],
            additionalProperties: false,
          },
        },
        topics_overall: { type: "array", items: { type: "string" } },
      },
      required: ["page_count", "figures"],
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

    const body = await req.json();
    const { paperId } = body as { paperId: string };
    if (!paperId) {
      return new Response(JSON.stringify({ error: "paperId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("past_papers").update({ parse_status: "processing", parse_error: null }).eq("id", paperId);

    const { data: paper, error: pErr } = await supabase.from("past_papers").select("*").eq("id", paperId).single();
    if (pErr || !paper) {
      return new Response(JSON.stringify({ error: pErr?.message ?? "paper not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download the PDF.
    const filePath = (paper as { file_path: string }).file_path;
    const { data: fileBlob, error: dErr } = await supabase.storage.from("papers").download(filePath);
    if (dErr || !fileBlob) {
      await supabase.from("past_papers").update({
        parse_status: "failed", parse_error: dErr?.message ?? "download failed",
      }).eq("id", paperId);
      return new Response(JSON.stringify({ error: "download failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const buf = new Uint8Array(await fileBlob.arrayBuffer());
    const b64 = base64Encode(buf);

    // Ask Gemini to index the figures.
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Index this past paper. Title: ${(paper as { title: string }).title}. Subject: ${(paper as { subject: string | null }).subject ?? "unknown"}. Identify every printed figure / diagram / graph and assign topic tags.` },
              { type: "file", file: { filename: "paper.pdf", file_data: `data:application/pdf;base64,${b64}` } },
            ],
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "save_paper_index" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      await supabase.from("past_papers").update({
        parse_status: "failed", parse_error: `AI ${aiResp.status}: ${txt.slice(0, 500)}`,
      }).eq("id", paperId);
      return new Response(JSON.stringify({ error: "AI failed", details: txt }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      await supabase.from("past_papers").update({
        parse_status: "failed", parse_error: "AI did not return structured index",
      }).eq("id", paperId);
      return new Response(JSON.stringify({ error: "no tool call" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = JSON.parse(toolCall.function.arguments);
    const pageCount: number = args.page_count ?? 0;
    const figures: Array<{ page_number: number; caption: string; topic_tags: string[] }> = args.figures ?? [];
    const topicsOverall: string[] = args.topics_overall ?? [];

    // Insert diagram rows. We point image_path at the original PDF since we can't crop.
    // The cascade will surface this as "see uploaded paper, page N".
    if (figures.length > 0) {
      const rows = figures.map((f) => ({
        paper_id: paperId,
        page_number: f.page_number,
        image_path: `papers/${filePath}`, // bucket-prefixed
        caption: f.caption,
        topic_tags: f.topic_tags,
        bbox: null,
      }));
      await supabase.from("past_paper_diagrams").insert(rows);
    }

    await supabase.from("past_papers").update({
      parse_status: "ready",
      page_count: pageCount,
      topics: topicsOverall,
    }).eq("id", paperId);

    return new Response(JSON.stringify({ ok: true, figures: figures.length, pages: pageCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
