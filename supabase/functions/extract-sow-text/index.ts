// Extract plain text from a Scheme of Work upload (PDF or DOCX).
// PDFs go through Gemini (vision). DOCX is unzipped in-process.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function extractDocxText(b64: string): Promise<string> {
  const bytes = b64ToBytes(b64);
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Not a valid .docx (missing word/document.xml)");
  const xml = await file.async("string");
  // Convert paragraph/break boundaries to newlines, strip remaining tags.
  const withBreaks = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br[^/]*\/>/g, "\n")
    .replace(/<w:tab[^/]*\/>/g, "\t");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  // Decode the few entities Word emits.
  const decoded = stripped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  // Collapse 3+ blank lines.
  return decoded.replace(/\n{3,}/g, "\n\n").trim();
}

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

    if (isDocx) {
      try {
        const text = await extractDocxText(file_base64);
        if (!text) {
          return new Response(JSON.stringify({ error: "DOCX had no readable text" }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ text }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("extract-sow-text docx error:", e);
        return new Response(JSON.stringify({ error: `DOCX read failed: ${e instanceof Error ? e.message : "unknown"}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // PDF path → Gemini.
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
      return new Response(JSON.stringify({ error: `Extraction failed (${aiResp.status}): ${txt.slice(0, 300)}` }),
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
