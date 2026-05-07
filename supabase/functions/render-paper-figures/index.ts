// Re-render figures detected by parse-paper into clean exam-style diagrams.
// Runs in the background (returns 202) and is idempotent: only processes
// `past_paper_diagrams` rows whose image_path still points at the source PDF
// ("papers/..."). Concurrency-pooled with a per-figure timeout so a single
// slow render can't kill the whole pass.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const POOL = 3;
const PER_FIGURE_TIMEOUT_MS = 25_000;

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { paperId } = await req.json() as { paperId: string };
    if (!paperId) {
      return new Response(JSON.stringify({ error: "paperId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const work = runRender(paperId).catch((e) =>
      console.error("[render-paper-figures] threw", e)
    );
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(work);
    }
    return new Response(JSON.stringify({ accepted: true, paperId }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

type DiagramRow = {
  id: string;
  paper_id: string;
  caption: string | null;
  topic_tags: string[] | null;
  image_path: string;
};

async function runRender(paperId: string): Promise<void> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows } = await supabase
    .from("past_paper_diagrams")
    .select("id, paper_id, caption, topic_tags, image_path")
    .eq("paper_id", paperId)
    .like("image_path", "papers/%");

  const todo = (rows ?? []) as DiagramRow[];
  if (todo.length === 0) return;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(POOL, todo.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= todo.length) return;
      const row = todo[i];
      try {
        await Promise.race([
          processOne(supabase, row),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("figure render timeout")), PER_FIGURE_TIMEOUT_MS),
          ),
        ]);
      } catch (e) {
        console.warn("[render-paper-figures] figure failed", row.id, e);
      }
    }
  });
  await Promise.all(workers);
}

// deno-lint-ignore no-explicit-any
async function processOne(supabase: any, row: DiagramRow): Promise<void> {
  const { description, subject, level, cleanCaption } = parseHints(row.caption ?? "");
  const tags = (row.topic_tags ?? []).join(", ");
  const desc = description || cleanCaption || tags;
  if (!desc) return;

  const subj = subject || "science";
  const lvl = level || "secondary";
  const prompt = `Re-render this figure from a Singapore MOE ${lvl} ${subj} past paper as a clean exam-style diagram.

What the figure shows: ${desc}
${cleanCaption ? `Original caption: ${cleanCaption}` : ""}
${tags ? `Topic context: ${tags}` : ""}

Requirements:
- Clean black-and-white line art only (no shading, no colour, no gradients).
- White background.
- Clear, legible labels in plain sans-serif.
- Match Singapore O-Level / PSLE past paper conventions.
- No watermarks, no captions inside the image, no decorative elements.
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
    console.warn("[render-paper-figures] AI failed", resp.status, (await resp.text()).slice(0, 200));
    return;
  }
  const json = await resp.json();
  const dataUrl: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl?.startsWith("data:")) return;

  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, comma);
  const b64 = dataUrl.slice(comma + 1);
  const contentType = meta.split(";")[0] || "image/png";
  const ext = contentType.split("/")[1] ?? "png";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = `specimen/${row.paper_id}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from("diagrams").upload(key, bytes, {
    contentType, upsert: false,
  });
  if (upload.error) {
    console.warn("[render-paper-figures] upload failed", upload.error);
    return;
  }
  await supabase
    .from("past_paper_diagrams")
    .update({ image_path: key, caption: cleanCaption })
    .eq("id", row.id);
}

function parseHints(caption: string): {
  description: string; subject: string; level: string; cleanCaption: string;
} {
  const m = caption.match(/<!--render:(.*?)-->/);
  if (!m) return { description: "", subject: "", level: "", cleanCaption: caption.trim() };
  try {
    const j = JSON.parse(m[1]);
    return {
      description: typeof j.d === "string" ? j.d : "",
      subject: typeof j.s === "string" ? j.s : "",
      level: typeof j.l === "string" ? j.l : "",
      cleanCaption: caption.replace(m[0], "").trim(),
    };
  } catch {
    return { description: "", subject: "", level: "", cleanCaption: caption.replace(m[0], "").trim() };
  }
}
