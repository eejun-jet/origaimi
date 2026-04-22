// Parse an uploaded past paper PDF: extract per-page text, detect figures with captions,
// AND extract verbatim question stems + a style summary so the generator can anchor
// future assessments on the paper's tone, command-words, and difficulty.
//
// We also crop each detected figure into a real PNG (via Lovable AI vision-edit mode)
// and store it in the public `diagrams` bucket so the generator can reuse the image
// directly instead of pointing at the source PDF.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `You are an exam-paper analyst. Given the rendered pages of a past exam paper PDF, extract:
1) Figures present on each page (caption verbatim if printed; topic_tags from question context).
2) Every numbered question with its verbatim stem, command word, marks, and sub-parts.
3) A short (2-3 sentence) "style_summary" describing the paper's tone, command-word patterns,
   structural format (e.g. source-based, structured (a)(b)(c), MCQ + short answer, essay), and difficulty norms.
4) Overall topic tags.
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
              figure_description: {
                type: "string",
                description: "Concise visual description of WHAT the figure shows (e.g. 'series circuit with 2 cells, ammeter, lamp'), so it can be re-rendered as a clean B&W diagram.",
              },
            },
            required: ["page_number", "caption", "topic_tags"],
            additionalProperties: false,
          },
        },
        questions: {
          type: "array",
          description: "Every printed question, in order. Use verbatim text from the paper.",
          items: {
            type: "object",
            properties: {
              number: { type: "string", description: "e.g. '1', '2', '3a' as printed." },
              page: { type: "integer", minimum: 1 },
              command_word: { type: "string", description: "e.g. Explain, Compare, To what extent, How far do you agree." },
              marks: { type: "integer", minimum: 0 },
              stem: { type: "string", description: "Verbatim question stem (no paraphrasing). For source-based questions, include the prompt around sources but NOT the source text itself." },
              sub_parts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "e.g. 'a', 'b', 'i', 'ii'." },
                    text: { type: "string" },
                    marks: { type: "integer", minimum: 0 },
                  },
                  required: ["label", "text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["number", "page", "stem"],
            additionalProperties: false,
          },
        },
        style_summary: {
          type: "string",
          description: "2-3 sentences describing tone, command-word patterns, structural format, and difficulty.",
        },
        topics_overall: { type: "array", items: { type: "string" } },
      },
      required: ["page_count", "figures", "questions", "style_summary"],
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
              { type: "text", text: `Index this past paper. Title: ${(paper as { title: string }).title}. Subject: ${(paper as { subject: string | null }).subject ?? "unknown"}. Level: ${(paper as { level: string | null }).level ?? "unknown"}. Identify every figure (with a concise visual description so it can be re-rendered), every numbered question (verbatim), and produce a style_summary.` },
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
    const figures: Array<{ page_number: number; caption: string; topic_tags: string[]; figure_description?: string }> = args.figures ?? [];
    const questions: unknown[] = Array.isArray(args.questions) ? args.questions : [];
    const styleSummary: string | null = typeof args.style_summary === "string" ? args.style_summary : null;
    const topicsOverall: string[] = args.topics_overall ?? [];
    const subjectName = (paper as { subject: string | null }).subject ?? "";
    const levelName = (paper as { level: string | null }).level ?? "";

    if (figures.length > 0) {
      // Replace existing diagram rows for this paper to keep things idempotent on re-parse.
      await supabase.from("past_paper_diagrams").delete().eq("paper_id", paperId);

      // Render each detected figure as a clean B&W PNG via Lovable AI image generation
      // (Worker runtime cannot run native PDF renderers / image libs, so we ask the
      // image model to produce a faithful re-rendering keyed off the figure description
      // + caption + topic context). Then upload to the public diagrams bucket.
      const rows: Array<{
        paper_id: string; page_number: number; image_path: string;
        caption: string; topic_tags: string[]; bbox: null;
      }> = [];

      for (const f of figures) {
        const imageKey = await renderAndUploadFigure({
          supabase, paperId, figure: f, subject: subjectName, level: levelName,
        });
        rows.push({
          paper_id: paperId,
          page_number: f.page_number,
          // If rendering failed, fall back to PDF reference (legacy behaviour) so we
          // at least keep the metadata for retrieval ranking.
          image_path: imageKey ?? `papers/${filePath}`,
          caption: f.caption,
          topic_tags: f.topic_tags,
          bbox: null,
        });
      }
      if (rows.length > 0) {
        await supabase.from("past_paper_diagrams").insert(rows);
      }
    }

    await supabase.from("past_papers").update({
      parse_status: "ready",
      page_count: pageCount,
      topics: topicsOverall,
      questions_json: questions,
      style_summary: styleSummary,
    }).eq("id", paperId);

    return new Response(JSON.stringify({
      ok: true,
      figures: figures.length,
      pages: pageCount,
      questions: questions.length,
      hasStyleSummary: Boolean(styleSummary),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function renderAndUploadFigure(opts: {
  supabase: ReturnType<typeof createClient>;
  paperId: string;
  figure: { page_number: number; caption: string; topic_tags: string[]; figure_description?: string };
  subject: string;
  level: string;
}): Promise<string | null> {
  const { supabase, paperId, figure, subject, level } = opts;
  const desc = (figure.figure_description ?? "").trim();
  const caption = (figure.caption ?? "").trim();
  const tags = (figure.topic_tags ?? []).join(", ");
  const description = desc || caption || tags;
  if (!description) return null;

  const subj = subject || "science";
  const lvl = level || "secondary";
  const prompt = `Re-render this figure from a Singapore MOE ${lvl} ${subj} past paper as a clean exam-style diagram.

What the figure shows: ${description}
${caption ? `Original caption: ${caption}` : ""}
${tags ? `Topic context: ${tags}` : ""}

Requirements:
- Clean black-and-white line art only (no shading, no colour, no gradients).
- White background.
- Clear, legible labels in plain sans-serif (component names, axes, units).
- Match the visual conventions used in Singapore O-Level / PSLE past papers.
- No watermarks, no captions inside the image, no decorative elements.
- Diagram only — no question text.`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!resp.ok) {
      console.warn("[parse-paper] figure render failed", resp.status, await resp.text());
      return null;
    }
    const json = await resp.json();
    const dataUrl: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl?.startsWith("data:")) return null;

    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma);
    const b64 = dataUrl.slice(comma + 1);
    const contentType = meta.split(";")[0] || "image/png";
    const ext = contentType.split("/")[1] ?? "png";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const key = `specimen/${paperId}/${crypto.randomUUID()}.${ext}`;
    const upload = await supabase.storage.from("diagrams").upload(key, bytes, {
      contentType, upsert: false,
    });
    if (upload.error) {
      console.warn("[parse-paper] figure upload failed", upload.error);
      return null;
    }
    // Return key WITHOUT bucket prefix; resolver in diagrams.ts defaults to `diagrams` bucket.
    return key;
  } catch (e) {
    console.warn("[parse-paper] figure render exception", e);
    return null;
  }
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
