// Standalone diagram generator using Nano Banana Pro.
// Used by the assessment review UI for on-demand "regenerate diagram" actions.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { questionId, topic, subject, instruction } = body as {
      questionId?: string; topic: string; subject: string; instruction?: string;
    };

    const prompt = `Generate a Singapore MOE exam-style diagram for a ${subject} question on "${topic}".
${instruction ? `Specific instruction: ${instruction}\n` : ""}
Requirements:
- Clean black-and-white line art only (no shading, no colour, no gradients).
- White background.
- Clear, legible labels in plain sans-serif.
- Match Singapore O-Level / PSLE past-paper conventions.
- No watermarks, no captions outside the diagram, no decorative elements.
- Diagram only — no question text.`;

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
      const txt = await resp.text();
      const status = resp.status === 429 ? 429 : resp.status === 402 ? 402 : 500;
      return new Response(JSON.stringify({ error: "AI failed", details: txt }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const dataUrl: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
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
    const key = `ai/manual/${crypto.randomUUID()}.${ext}`;
    const upload = await supabase.storage.from("diagrams").upload(key, bytes, { contentType, upsert: false });
    if (upload.error) {
      return new Response(JSON.stringify({ error: upload.error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pub = supabase.storage.from("diagrams").getPublicUrl(key);
    const url = pub.data.publicUrl;

    if (questionId) {
      await supabase.from("assessment_questions").update({
        diagram_url: url,
        diagram_source: "ai_generated",
        diagram_citation: null,
        diagram_caption: `${topic} (AI-generated diagram)`,
      }).eq("id", questionId);
    }

    return new Response(JSON.stringify({ ok: true, url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
