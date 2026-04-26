// Provenance generator for SBQ source pools.
//
// SEAB History / Social Studies SBQ sources are always introduced with a
// short provenance ("an editorial published in The Straits Times in August
// 1965", "a speech delivered by Winston Churchill on 18 June 1940"). The
// crawler returns publisher + page title only — not enough on its own. We
// ask Lovable AI Gateway to write ONE provenance sentence per source in a
// single batched call, then merge the results back onto the source objects.
//
// Failures are non-fatal: if the AI call times out or returns malformed
// JSON we fall back to a deterministic "From <publisher>: <title>." so
// every source still ships with SOMETHING in its provenance slot.

import type { GroundedSource, GroundedImageSource } from "./sources.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const PROVENANCE_TIMEOUT_MS = 12_000;
const PROVENANCE_MODEL = "google/gemini-2.5-flash-lite";

type ProvenanceItem = {
  index: number;
  kind: "text" | "image";
  publisher: string;
  source_title: string;
  source_url: string;
  /** First ~600 chars of the excerpt for context, OR the image caption. */
  context: string;
};

function fallbackProvenance(item: { publisher: string; source_title: string }): string {
  const pub = item.publisher?.trim() || "Unknown source";
  const title = item.source_title?.trim();
  return title ? `From ${pub}: ${title}.` : `From ${pub}.`;
}

/** Strip marker tokens that would break our source_excerpt encoding if they
 *  ever appeared inside a provenance sentence (defensive — the AI shouldn't
 *  emit them, but we sanitise anyway). */
function sanitiseProvenance(s: string): string {
  return s
    .replace(/\[(PROV|URL|TEXT|IMAGE)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate a one-sentence provenance for each source in the SBQ pool.
 * Returns arrays of strings aligned with the input arrays (same length,
 * same order). Sources that already have a `provenance` field set are
 * passed through unchanged and excluded from the AI call.
 */
export async function generateProvenances(
  textSources: GroundedSource[],
  imageSources: GroundedImageSource[],
  topic: string,
): Promise<{ textProv: string[]; imageProv: string[] }> {
  // Pre-fill from any existing provenance + deterministic fallback.
  const textProv = textSources.map((s) => s.provenance ?? fallbackProvenance(s));
  const imageProv = imageSources.map((s) => s.provenance ?? fallbackProvenance(s));

  if (!LOVABLE_API_KEY) {
    console.warn("[provenance] LOVABLE_API_KEY missing — using deterministic fallback");
    return { textProv, imageProv };
  }

  // Only ask the AI for sources that don't already have a curated provenance.
  const items: ProvenanceItem[] = [];
  textSources.forEach((s, i) => {
    if (s.provenance) return;
    items.push({
      index: i,
      kind: "text",
      publisher: s.publisher,
      source_title: s.source_title,
      source_url: s.source_url,
      context: (s.excerpt ?? "").slice(0, 600),
    });
  });
  imageSources.forEach((s, i) => {
    if (s.provenance) return;
    items.push({
      index: i + textSources.length, // global index for the AI; we'll demux later
      kind: "image",
      publisher: s.publisher,
      source_title: s.source_title,
      source_url: s.source_url,
      context: s.caption ?? "",
    });
  });

  if (items.length === 0) {
    return { textProv, imageProv };
  }

  const sourcesForPrompt = items.map((it, i) => ({
    item_index: i,
    kind: it.kind,
    publisher: it.publisher,
    title: it.source_title,
    url: it.source_url,
    context: it.context,
  }));

  const systemPrompt = [
    "You are an exam paper editor preparing source-based questions for Singapore SEAB History / Social Studies papers.",
    "For each source, write ONE concise provenance sentence in the style used in SEAB SBQ papers.",
    "Provenance must name (where inferable from the publisher, title, and context):",
    "  • the TYPE of source — speech, editorial, government white paper, memoir, treaty, cartoon, propaganda poster, photograph, statistical chart, map;",
    "  • the AUTHOR or ISSUING BODY (person, government, newspaper);",
    "  • the VENUE / PUBLICATION (where it appeared);",
    "  • the DATE (month + year if possible, otherwise year, otherwise 'undated').",
    "Examples:",
    "  • 'A speech delivered by Winston Churchill to the House of Commons on 18 June 1940.'",
    "  • 'An editorial published in The Straits Times on 9 August 1965.'",
    "  • 'A political cartoon by David Low, published in the Evening Standard, 1936.'",
    "  • 'A photograph of Allied troops landing at Normandy, 6 June 1944, from the US National Archives.'",
    "Rules:",
    "  • EXACTLY ONE sentence per source, ≤ 30 words.",
    "  • Do NOT include URLs, hyperlinks, or square-bracket markers.",
    "  • Do NOT add quotation marks around the sentence.",
    "  • If the publisher / context is too thin to infer details, write a generic but truthful sentence (e.g. 'A primary-source extract from the US National Archives website, undated.').",
  ].join("\n");

  const userPrompt = JSON.stringify({
    topic,
    sources: sourcesForPrompt,
  });

  const tool = {
    type: "function",
    function: {
      name: "save_provenances",
      description: "Return one provenance sentence per source.",
      parameters: {
        type: "object",
        properties: {
          provenances: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_index: { type: "integer" },
                provenance: { type: "string" },
              },
              required: ["item_index", "provenance"],
              additionalProperties: false,
            },
          },
        },
        required: ["provenances"],
        additionalProperties: false,
      },
    },
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROVENANCE_TIMEOUT_MS);
  let json: any = null;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: PROVENANCE_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "save_provenances" } },
      }),
    });
    clearTimeout(t);
    if (!resp.ok) {
      console.warn(`[provenance] AI gateway returned ${resp.status} — using fallback`);
      return { textProv, imageProv };
    }
    json = await resp.json();
  } catch (e) {
    clearTimeout(t);
    console.warn("[provenance] AI call failed:", (e as Error).message);
    return { textProv, imageProv };
  }

  // Parse tool-call args.
  let entries: { item_index: number; provenance: string }[] = [];
  try {
    const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (argsStr) {
      const parsed = JSON.parse(argsStr);
      if (Array.isArray(parsed?.provenances)) entries = parsed.provenances;
    }
  } catch (e) {
    console.warn("[provenance] failed to parse tool call:", (e as Error).message);
    return { textProv, imageProv };
  }

  // Merge AI-generated provenance back into the aligned arrays.
  for (const entry of entries) {
    const it = items[entry.item_index];
    if (!it) continue;
    const sentence = sanitiseProvenance(entry.provenance ?? "");
    if (!sentence) continue;
    if (it.kind === "text") {
      textProv[it.index] = sentence;
    } else {
      const localIdx = it.index - textSources.length;
      if (localIdx >= 0 && localIdx < imageProv.length) {
        imageProv[localIdx] = sentence;
      }
    }
  }

  return { textProv, imageProv };
}
