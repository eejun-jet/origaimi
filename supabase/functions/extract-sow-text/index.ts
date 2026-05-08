// Extract plain text from a Scheme of Work upload (PDF or DOCX) using Gemini.
// Returns { text } so the client can drop it straight into the SoW textarea.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { file_base64, mime_type, filename } = await req.json();
    if (!file_base64 || !mime_type) {
      return new Response(JSON.stringify({ error: "file_base64 and mime_type required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const lower = (filename ?? "").toLowerCase();
    const isPdf = mime_type === "application/pdf" || lower.endsWith(".pdf");
    const isDocx = mime_type.includes("wordprocessingml") || lower.endsWith(".docx");
    if (!isPdf && !isDocx) {
      return new Response(JSON.stringify({ error: "Only PDF or .docx supported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You receive a teacher's Scheme of Work document. Extract a clean, readable plain-text version: keep weekly/lesson headings, key concepts, planned activities, materials, and assessment notes. Drop page numbers and decorative formatting. Preserve order. Do NOT summarise — return the full content as text.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the full Scheme of Work as plain text." },
              { type: "image_url", image_url: { url: `data:${mime_type};base64,${file_base64}` } },
            ],
          },
        ],
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a minute." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("extract-sow-text AI error:", aiResp.status, txt);
      return new Response(JSON.stringify({ error: "Extraction failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const aiJson = await aiResp.json();
    const text: string = aiJson?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ text }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("extract-sow-text fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
