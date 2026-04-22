// Standalone diagram generator using Nano Banana 2 (with Pro fallback).
// Supports three modes:
//   - "generate"   : text-to-image (default; original behaviour)
//   - "edit"       : image-edit using the existing diagram + an instruction
//   - "regenerate" : fresh text-to-image steered by an optional instruction

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const FLASH_MODEL = "google/gemini-3.1-flash-image-preview"; // Nano Banana 2 — fast, edit-capable
const PRO_MODEL = "google/gemini-3-pro-image-preview";       // Higher fidelity fallback

type Mode = "generate" | "edit" | "regenerate";

const styleRules = `Requirements:
- Clean black-and-white line art only (no shading, no colour, no gradients).
- White background.
- Clear, legible labels in plain sans-serif.
- Match Singapore O-Level / PSLE past-paper conventions.
- No watermarks, no captions outside the diagram, no decorative elements.
- Diagram only — no question text.`;

function buildGeneratePrompt(subject: string, topic: string, instruction?: string) {
  return `Generate a Singapore MOE exam-style diagram for a ${subject} question on "${topic}".
${instruction ? `Specific instruction: ${instruction}\n` : ""}
${styleRules}`;
}

function buildEditInstruction(instruction: string) {
  return `Edit the attached diagram with the following change: ${instruction}.
Preserve the existing layout, labels, and unchanged elements exactly. Only apply the requested change.
${styleRules}`;
}

async function callImageModel(model: string, messages: unknown[]) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, modalities: ["image", "text"] }),
  });
}

function extractImage(json: any): string | undefined {
  return json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      questionId,
      topic,
      subject,
      instruction,
      mode = "generate",
      currentDiagramUrl,
    } = body as {
      questionId?: string;
      topic: string;
      subject: string;
      instruction?: string;
      mode?: Mode;
      currentDiagramUrl?: string;
    };

    // Build the messages payload depending on the requested mode.
    let messages: unknown[];
    if (mode === "edit") {
      if (!currentDiagramUrl) {
        return new Response(JSON.stringify({ error: "edit mode requires currentDiagramUrl" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!instruction || !instruction.trim()) {
        return new Response(JSON.stringify({ error: "edit mode requires an instruction" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      messages = [
        {
          role: "user",
          content: [
            { type: "text", text: buildEditInstruction(instruction.trim()) },
            { type: "image_url", image_url: { url: currentDiagramUrl } },
          ],
        },
      ];
    } else {
      // generate or regenerate — both are text-to-image; regenerate just allows steering.
      messages = [{ role: "user", content: buildGeneratePrompt(subject, topic, instruction) }];
    }

    // First attempt with Flash (Nano Banana 2).
    let resp = await callImageModel(FLASH_MODEL, messages);
    let dataUrl: string | undefined;
    if (resp.ok) {
      const json = await resp.json();
      dataUrl = extractImage(json);
    }

    // Fallback to Pro for fresh generations if Flash failed or returned no image.
    if (!dataUrl && (mode === "generate" || mode === "regenerate")) {
      resp = await callImageModel(PRO_MODEL, messages);
      if (resp.ok) {
        const json = await resp.json();
        dataUrl = extractImage(json);
      }
    }

    if (!resp.ok && !dataUrl) {
      const txt = await resp.text();
      const status = resp.status === 429 ? 429 : resp.status === 402 ? 402 : 500;
      return new Response(JSON.stringify({ error: "AI failed", details: txt }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!dataUrl?.startsWith("data:")) {
      return new Response(JSON.stringify({ error: "no image returned" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma);
    const b64 = dataUrl.slice(comma + 1);
    const contentType = meta.split(";")[0] || "image/png";
    const ext = contentType.split("/")[1] ?? "png";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const folder = mode === "edit" ? "ai/edit" : "ai/manual";
    const key = `${folder}/${crypto.randomUUID()}.${ext}`;
    const upload = await supabase.storage.from("diagrams").upload(key, bytes, { contentType, upsert: false });
    if (upload.error) {
      return new Response(JSON.stringify({ error: upload.error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pub = supabase.storage.from("diagrams").getPublicUrl(key);
    const url = pub.data.publicUrl;

    if (questionId) {
      // Edits keep the existing caption so labels don't drift; fresh generations refresh it.
      const patch: Record<string, unknown> = {
        diagram_url: url,
        diagram_source: mode === "edit" ? "ai_edited" : "ai_generated",
        diagram_citation: null,
      };
      if (mode !== "edit") {
        patch.diagram_caption = `${topic} (AI-generated diagram)`;
      }
      await supabase.from("assessment_questions").update(patch).eq("id", questionId);
    }

    return new Response(JSON.stringify({
      ok: true,
      url,
      mode,
      diagram_source: mode === "edit" ? "ai_edited" : "ai_generated",
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
