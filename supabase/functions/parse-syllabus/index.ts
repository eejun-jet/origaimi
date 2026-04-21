import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `You are a meticulous curriculum analyst extracting the structure of a Singapore MOE / SEAB / Cambridge syllabus document.

CRITICAL RULES on codes:
- Capture every printed reference number (syllabus codes like "2260/01", "6091", "0001"; topic codes like "1.2.3", "MA.P5.NUM.3a") VERBATIM as text — preserve leading zeros, slashes, and dots.
- NEVER invent a code. If a topic has no printed code, return null for topic_code.
- Extract the document-level syllabus_code from the cover/header FIRST.

CRITICAL RULES on papers (multi-paper syllabuses):
- Many syllabuses (e.g. Combined Humanities 2261, Combined Science 5076/5077/5078/5086) contain MULTIPLE PAPERS in one document.
- Detect this by looking for an examination format / scheme of assessment table on the cover or intro pages, typically with columns like "Paper No. | Component | Marks | Weighting | Duration".
- Emit ONE entry in the papers[] array PER paper found. Use paper_number "1", "2", etc. verbatim.
- If the document covers a SINGLE paper, still emit one entry with paper_number "1".
- For each topic, set its paper_number to the paper it belongs to. Use textual cues: section headings like "Paper 1: Social Studies", "Paper 2 (History)", or theme blocks that follow such a heading.
- If a topic genuinely applies to all papers (rare — e.g. shared skills), use paper_number null.

CRITICAL RULES on multi-track / sectioned syllabuses (e.g. Combined Science 5086, 5076, 5077, 5078):
- Some syllabuses split content into discipline SECTIONS (Physics / Chemistry / Biology) where one paper draws content from MULTIPLE sections (e.g. a shared MCQ paper) and other papers are dedicated to a single section.
- For each PAPER, set:
    section: the single discipline if the paper is dedicated (e.g. "Physics"), or null if it spans multiple sections.
    track_tags: lowercase array of all sections this paper draws from, e.g. ["physics","chemistry","biology"] for a shared MCQ paper, ["physics"] for a Physics-only paper.
- For each TOPIC, set section to the discipline heading it sits under verbatim ("Physics", "Chemistry", "Biology"), or null if not applicable.
- For combined-subject syllabuses where each paper is itself a single subject (e.g. Combined Humanities 2261 = SS + History/Geo/Lit), DO NOT use section — use component_name on the paper instead and leave section null.

CRITICAL RULES on assessment_mode:
- For each paper, classify the mode of assessment as one of: "written" (default), "oral" (spoken response), "listening" (audio comprehension), "practical" (lab / hands-on).
- English Language papers typically have a Paper 3 Listening + Paper 4 Oral. Combined Science Paper 5 is Practical.

You will be given the raw text of a syllabus document. Build a flat list of topics where each topic carries:
- topic_code (verbatim, or null)
- parent_code (the code of its parent in the hierarchy, or null for top-level)
- learning_outcome_code (if separate from topic_code)
- strand / sub_strand labels
- title (short readable name)
- learning_outcomes (array of "students should be able to..." statements, verbatim where possible)
- suggested_blooms (subset of: Remember, Understand, Apply, Analyse, Evaluate, Create)
- depth (0 = strand, 1 = sub-strand, 2 = topic, 3 = sub-topic)
- paper_number (which paper this topic belongs to, or null)
- section (discipline section the topic belongs to in multi-track syllabuses, or null)

Also extract document-level fields: syllabus_code, paper_code, exam_board, syllabus_year, subject, level.`;

const TOOL = {
  type: "function",
  function: {
    name: "save_syllabus",
    description: "Save the extracted syllabus structure including any sub-papers.",
    parameters: {
      type: "object",
      properties: {
        document: {
          type: "object",
          properties: {
            syllabus_code: { type: ["string", "null"] },
            paper_code: { type: ["string", "null"] },
            exam_board: { type: ["string", "null"], enum: ["MOE", "SEAB", "Cambridge", null] },
            syllabus_year: { type: ["integer", "null"] },
            subject: { type: ["string", "null"] },
            level: { type: ["string", "null"] },
          },
          required: ["syllabus_code", "paper_code", "exam_board", "syllabus_year", "subject", "level"],
          additionalProperties: false,
        },
        papers: {
          type: "array",
          description: "One entry per paper detected. Always emit at least one entry — use paper_number '1' for single-paper docs.",
          items: {
            type: "object",
            properties: {
              paper_number: { type: "string", description: "Verbatim paper number, e.g. '1', '2'." },
              component_name: { type: ["string", "null"], description: "e.g. 'Social Studies', 'History', 'Theory'." },
              marks: { type: ["integer", "null"] },
              weighting_percent: { type: ["integer", "null"] },
              duration_minutes: { type: ["integer", "null"], description: "Convert e.g. '1 hr 45 min' to 105." },
              topic_theme: { type: ["string", "null"], description: "Overall theme/title for this paper if printed." },
              section: { type: ["string", "null"], description: "Discipline section if dedicated, e.g. 'Physics' / 'Chemistry' / 'Biology'. Null if cross-section or not applicable." },
              track_tags: { type: "array", items: { type: "string" }, description: "Lowercase tags for which sections this paper covers, e.g. ['physics','chemistry','biology']. Empty array if not applicable." },
              is_optional: { type: "boolean", description: "True for rare alternative / optional papers; false otherwise." },
              assessment_mode: { type: ["string", "null"], enum: ["written", "oral", "listening", "practical", null], description: "Mode of assessment. Default 'written'." },
            },
            required: ["paper_number", "component_name", "marks", "weighting_percent", "duration_minutes", "topic_theme", "section", "track_tags", "is_optional", "assessment_mode"],
            additionalProperties: false,
          },
        },
        topics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic_code: { type: ["string", "null"] },
              parent_code: { type: ["string", "null"] },
              learning_outcome_code: { type: ["string", "null"] },
              strand: { type: ["string", "null"] },
              sub_strand: { type: ["string", "null"] },
              title: { type: "string" },
              learning_outcomes: { type: "array", items: { type: "string" } },
              suggested_blooms: { type: "array", items: { type: "string", enum: ["Remember", "Understand", "Apply", "Analyse", "Evaluate", "Create"] } },
              depth: { type: "integer", minimum: 0, maximum: 5 },
              paper_number: { type: ["string", "null"], description: "Which paper this topic belongs to (matches papers[].paper_number), or null if it applies to all." },
              section: { type: ["string", "null"], description: "Discipline section heading (Physics/Chemistry/Biology), or null." },
            },
            required: ["topic_code", "parent_code", "title", "learning_outcomes", "suggested_blooms", "depth", "paper_number", "section"],
            additionalProperties: false,
          },
        },
      },
      required: ["document", "papers", "topics"],
      additionalProperties: false,
    },
  },
};

async function fileToText(supabase: any, filePath: string, mimeType: string): Promise<string> {
  const { data, error } = await supabase.storage.from("syllabi").download(filePath);
  if (error || !data) throw new Error(`Download failed: ${error?.message}`);

  if (mimeType?.startsWith("text/") || filePath.endsWith(".txt") || filePath.endsWith(".md")) {
    return await data.text();
  }
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return `__BINARY_BASE64__:${mimeType}:${btoa(bin)}`;
}

function composePaperCode(syllabusCode: string | null, paperNumber: string | null): string | null {
  if (!syllabusCode || !paperNumber) return null;
  // Pad numeric paper numbers to 2 digits; preserve non-numeric verbatim.
  const padded = /^\d+$/.test(paperNumber) ? paperNumber.padStart(2, "0") : paperNumber;
  return `${syllabusCode}/${padded}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { documentId } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("syllabus_documents").update({ parse_status: "parsing", parse_error: null }).eq("id", documentId);

    const { data: doc, error: docErr } = await supabase
      .from("syllabus_documents")
      .select("*")
      .eq("id", documentId)
      .single();
    if (docErr || !doc) throw new Error(`Document not found: ${docErr?.message}`);

    const content = await fileToText(supabase, doc.file_path, doc.mime_type ?? "");

    let userMessage: any;
    if (content.startsWith("__BINARY_BASE64__:")) {
      const [, mime, b64] = content.split(":", 3);
      userMessage = {
        role: "user",
        content: [
          { type: "text", text: `Extract the full syllabus structure from this document, including ALL papers if multi-paper, and tag papers/topics with discipline section + assessment mode where applicable. Title hint: "${doc.title}". Subject hint: ${doc.subject ?? "unknown"}. Level hint: ${doc.level ?? "unknown"}.` },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      };
    } else {
      userMessage = {
        role: "user",
        content: `Extract the full syllabus structure from this document, including ALL papers if multi-paper, and tag papers/topics with discipline section + assessment mode where applicable.\n\nTitle hint: "${doc.title}"\nSubject hint: ${doc.subject ?? "unknown"}\nLevel hint: ${doc.level ?? "unknown"}\n\n--- DOCUMENT TEXT ---\n${content.slice(0, 200000)}`,
      };
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          userMessage,
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "save_syllabus" } },
      }),
    });

    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error("AI error", aiResp.status, errTxt);
      await supabase.from("syllabus_documents").update({ parse_status: "failed", parse_error: `AI ${aiResp.status}: ${errTxt.slice(0, 500)}` }).eq("id", documentId);
      const status = aiResp.status === 429 ? 429 : aiResp.status === 402 ? 402 : 500;
      return new Response(JSON.stringify({ error: "AI failed", details: errTxt.slice(0, 500) }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      await supabase.from("syllabus_documents").update({ parse_status: "failed", parse_error: "No tool call returned" }).eq("id", documentId);
      return new Response(JSON.stringify({ error: "No structured output" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const args = JSON.parse(toolCall.function.arguments);
    const docMeta = args.document ?? {};
    const papers: any[] = args.papers ?? [];
    const topics: any[] = args.topics ?? [];

    // Resolve final syllabus_code (user-supplied takes precedence).
    const finalSyllabusCode = doc.syllabus_code ?? docMeta.syllabus_code ?? null;

    // Update document metadata
    await supabase.from("syllabus_documents").update({
      syllabus_code: finalSyllabusCode,
      paper_code: doc.paper_code ?? docMeta.paper_code ?? null,
      exam_board: doc.exam_board ?? docMeta.exam_board ?? "MOE",
      syllabus_year: doc.syllabus_year ?? docMeta.syllabus_year ?? null,
      subject: doc.subject ?? docMeta.subject ?? null,
      level: doc.level ?? docMeta.level ?? null,
      parse_status: "parsed",
    }).eq("id", documentId);

    // Replace existing papers + topics for this doc
    await supabase.from("syllabus_topics").delete().eq("source_doc_id", documentId);
    await supabase.from("syllabus_papers").delete().eq("source_doc_id", documentId);

    // Ensure at least one paper exists (defensive — schema requires it)
    const safePapers = papers.length > 0
      ? papers
      : [{ paper_number: "1", component_name: null, marks: null, weighting_percent: null, duration_minutes: null, topic_theme: null, section: null, track_tags: [], is_optional: false, assessment_mode: "written" }];

    const paperRows = safePapers.map((p, i) => ({
      source_doc_id: documentId,
      paper_number: String(p.paper_number ?? (i + 1)),
      paper_code: composePaperCode(finalSyllabusCode, String(p.paper_number ?? (i + 1))),
      component_name: p.component_name ?? null,
      marks: p.marks ?? null,
      weighting_percent: p.weighting_percent ?? null,
      duration_minutes: p.duration_minutes ?? null,
      topic_theme: p.topic_theme ?? null,
      section: p.section ?? null,
      track_tags: Array.isArray(p.track_tags) ? p.track_tags.map((t: string) => String(t).toLowerCase()) : [],
      is_optional: !!p.is_optional,
      assessment_mode: p.assessment_mode ?? "written",
      position: i,
    }));

    const { data: insertedPapers, error: papErr } = await supabase
      .from("syllabus_papers")
      .insert(paperRows)
      .select("id, paper_number");
    if (papErr) {
      console.error("Insert papers error", papErr);
      await supabase.from("syllabus_documents").update({ parse_status: "failed", parse_error: papErr.message }).eq("id", documentId);
      return new Response(JSON.stringify({ error: papErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build paper_number -> id map
    const paperIdByNumber = new Map<string, string>();
    for (const p of insertedPapers ?? []) paperIdByNumber.set(String(p.paper_number), p.id);
    const fallbackPaperId = insertedPapers?.[0]?.id ?? null;

    if (topics.length > 0) {
      const rows = topics.map((t, i) => {
        const num = t.paper_number != null ? String(t.paper_number) : null;
        const paper_id = num ? (paperIdByNumber.get(num) ?? fallbackPaperId) : fallbackPaperId;
        return {
          source_doc_id: documentId,
          paper_id,
          topic_code: t.topic_code ?? null,
          parent_code: t.parent_code ?? null,
          learning_outcome_code: t.learning_outcome_code ?? null,
          strand: t.strand ?? null,
          sub_strand: t.sub_strand ?? null,
          title: t.title,
          learning_outcomes: t.learning_outcomes ?? [],
          suggested_blooms: t.suggested_blooms ?? [],
          depth: t.depth ?? 0,
          position: i,
          subject: doc.subject ?? docMeta.subject ?? null,
          level: doc.level ?? docMeta.level ?? null,
          section: t.section ?? null,
        };
      });
      const { error: insErr } = await supabase.from("syllabus_topics").insert(rows);
      if (insErr) {
        console.error("Insert topics error", insErr);
        await supabase.from("syllabus_documents").update({ parse_status: "failed", parse_error: insErr.message }).eq("id", documentId);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ ok: true, topicCount: topics.length, paperCount: paperRows.length, document: docMeta }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
