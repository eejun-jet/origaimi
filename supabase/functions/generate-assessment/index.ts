import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { fetchGroundedSource, classifySubject, type GroundedSource } from "./sources.ts";
import { fetchDiagram, classifyScienceMath, questionWantsDiagram } from "./diagrams.ts";
import { fetchExemplars } from "./exemplars.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ---------- Types ----------

type SectionTopic = {
  topic: string;
  topic_code?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
};

type Section = {
  id?: string;
  letter: string;
  name?: string;
  question_type: string;
  marks: number;
  num_questions: number;
  bloom?: string;
  topic_pool: SectionTopic[];
  instructions?: string;
};

type LegacyBlueprintRow = {
  topic: string;
  bloom?: string;
  marks: number;
  topic_code?: string | null;
  section?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  mcq: "multiple-choice (4 options, one correct)",
  short_answer: "short-answer (1-2 sentence response)",
  structured: "structured (multi-part, e.g. (a), (b), (c))",
  long: "long-answer / essay",
  comprehension: "comprehension passage with sub-questions",
  practical: "practical / applied scenario",
  source_based: "source-based with stimulus and analysis",
};

// ---------- Blueprint normalisation ----------

function toSections(blueprint: unknown, defaultType: string, fallbackQuestionTypes: string[]): Section[] {
  // New shape: { sections: [...] }
  if (
    blueprint &&
    typeof blueprint === "object" &&
    !Array.isArray(blueprint) &&
    Array.isArray((blueprint as { sections?: unknown }).sections)
  ) {
    return ((blueprint as { sections: Section[] }).sections).map((s, i) => ({
      ...s,
      letter: s.letter ?? String.fromCharCode(65 + i),
      num_questions: Math.max(1, s.num_questions || 1),
      marks: Math.max(1, s.marks || 1),
      topic_pool: Array.isArray(s.topic_pool) ? s.topic_pool : [],
    }));
  }
  // Legacy flat shape: collapse into a single virtual section.
  if (Array.isArray(blueprint)) {
    const rows = blueprint as LegacyBlueprintRow[];
    if (rows.length === 0) return [];
    const totalMarks = rows.reduce((acc, r) => acc + (r.marks || 0), 0);
    return [{
      letter: "A",
      question_type: fallbackQuestionTypes[0] ?? defaultType,
      marks: totalMarks,
      num_questions: rows.length,
      bloom: rows[0]?.bloom ?? "Apply",
      topic_pool: rows.map((r) => ({
        topic: r.topic,
        topic_code: r.topic_code ?? null,
        learning_outcomes: r.learning_outcomes,
        ao_codes: r.ao_codes,
        outcome_categories: r.outcome_categories,
      })),
      instructions: "Answer all questions in this section.",
    }];
  }
  return [];
}

// ---------- Prompts ----------

function buildSystemPrompt(subject: string, level: string, paperCode?: string | null) {
  const alignLine = paperCode
    ? `All questions must align to MOE syllabus paper ${paperCode}. Reference the topic code (e.g. §1.2) when relevant in mark schemes.`
    : "";
  return `You are an expert assessment writer for the Singapore Ministry of Education (MOE) syllabus.
You write clear, fair, age-appropriate questions for ${level} ${subject}.
Always use British English spelling and SI units. Use Singapore-relevant contexts (HDB, MRT, hawker centres, neighbourhood schools, local names like Wei Ling, Aravind, Mei Ling, Hadi) where natural.
Match MOE phrasing conventions and difficulty norms for ${level}.
${alignLine}
Each question must include a clear stem, a precise answer, and a marking scheme that breaks down marks where appropriate.
Use Bloom's taxonomy levels rigorously.
When a "GROUNDED SOURCE" block is provided for a question, you MUST:
  - Place the verbatim source text inside the question stem under a "Source A" heading (or "Passage" for English comprehension).
  - NOT paraphrase, summarise, translate, or alter the source text in any way.
  - Add a citation line directly under the source: \`Source: {publisher} — {url}\`.
  - Write your sub-questions to refer to the passage / Source A by name (e.g. "According to Source A, …").
  - NEVER fabricate sources, attributions, or URLs of your own.`;
}

function buildSectionUserPrompt(opts: {
  title: string; subject: string; level: string; assessmentType: string;
  durationMinutes: number; totalMarks: number;
  section: Section; sectionIndex: number; totalSections: number;
  syllabusCode?: string | null; paperCode?: string | null;
  groundedSources: (GroundedSource | null)[]; // index-aligned with section.num_questions
  instructions?: string;
}) {
  const { section } = opts;
  const typeLabel = QUESTION_TYPE_LABELS[section.question_type] ?? section.question_type;

  const topicLines = section.topic_pool.map((t, i) => {
    const code = t.topic_code ? ` [${t.topic_code}]` : "";
    const los = t.learning_outcomes && t.learning_outcomes.length > 0
      ? `\n     Learning outcomes: ${t.learning_outcomes.slice(0, 3).map((lo) => `• ${lo}`).join(" ")}`
      : "";
    const aos = t.ao_codes && t.ao_codes.length > 0
      ? `\n     Assessment Objectives: ${t.ao_codes.join(", ")}`
      : "";
    return `  ${i + 1}. ${t.topic}${code}${los}${aos}`;
  }).join("\n");

  const sourceBlocks = opts.groundedSources.map((src, i) => {
    if (!src) return "";
    return `\n  Question ${i + 1} GROUNDED SOURCE (use verbatim, do not modify):
  ---
  ${src.excerpt}
  ---
  Citation: Source: ${src.publisher} — ${src.source_url}
  Set source_excerpt to the exact text between the dashes above. Set source_url to ${src.source_url}.`;
  }).join("\n");

  const grounding = opts.paperCode
    ? `Aligned to MOE syllabus ${opts.syllabusCode ?? ""} paper ${opts.paperCode}.\n`
    : "";

  const perQMarks = Math.floor(section.marks / Math.max(1, section.num_questions));
  const remainder = section.marks - perQMarks * section.num_questions;
  const marksGuide = remainder > 0
    ? `Distribute ${section.marks} marks across ${section.num_questions} questions. Most questions get ${perQMarks} marks; ${remainder} question(s) get 1 extra mark.`
    : `Each of the ${section.num_questions} question(s) is worth ${perQMarks} marks (total ${section.marks}).`;

  const sectionLabel = section.name ? `Section ${section.letter} — ${section.name}` : `Section ${section.letter}`;

  return `${grounding}You are drafting ${sectionLabel} of "${opts.title}" (${opts.level} ${opts.subject}, ${opts.assessmentType}, ${opts.durationMinutes} min, ${opts.totalMarks} total marks across ${opts.totalSections} sections).

THIS SECTION:
  - Question type for ALL questions in this section: ${typeLabel} — DO NOT mix in other types.
  - Number of questions: exactly ${section.num_questions}
  - Total marks for the section: ${section.marks}
  - ${marksGuide}
  - Bloom's level focus: ${section.bloom ?? "Apply"} (use other levels only if the topic clearly demands it)
  ${section.instructions ? `- Section instructions for the rubric: ${section.instructions}` : ""}

ALLOWED TOPICS (pick from these only — DO NOT invent topics outside this pool):
${topicLines}
${sourceBlocks}

${opts.instructions ? `TEACHER INSTRUCTIONS (apply to all questions):\n${opts.instructions}\n` : ""}
For every question:
  - question_type MUST be exactly "${section.question_type}".
  - For MCQ provide exactly 4 options as an array; for non-MCQ, options must be null.
  - difficulty: easy | medium | hard.
  - bloom_level: Remember | Understand | Apply | Analyse | Evaluate | Create.
  - The topic field must be one of the allowed topics above (verbatim).
${section.question_type === "source_based" || section.question_type === "comprehension"
    ? `  - This is a ${section.question_type === "source_based" ? "source-based" : "comprehension"} question. Build sub-parts (a), (b), (c) that explicitly REFER TO Source A by name and require analysis/inference of the passage — never generic content recall that ignores the source.`
    : ""}

Call the tool save_assessment with the full list of ${section.num_questions} questions for this section.`;
}

const TOOL = {
  type: "function",
  function: {
    name: "save_assessment",
    description: "Save the questions for this assessment section.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_type: { type: "string", enum: ["mcq", "short_answer", "structured", "long", "comprehension", "practical", "source_based"] },
              topic: { type: "string" },
              bloom_level: { type: "string", enum: ["Remember", "Understand", "Apply", "Analyse", "Evaluate", "Create"] },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
              marks: { type: "integer", minimum: 1 },
              stem: { type: "string", description: "The question text. For structured questions include sub-parts (a), (b), etc. For source-based questions include the verbatim Source A block + citation, then the sub-parts." },
              options: { type: ["array", "null"], items: { type: "string" }, description: "MCQ options or null." },
              answer: { type: "string", description: "The correct answer (for MCQ, the letter and option text)." },
              mark_scheme: { type: "string", description: "Marking rubric showing how to award marks." },
              source_excerpt: { type: ["string", "null"], description: "Verbatim source passage used in the stem (only when a GROUNDED SOURCE was provided)." },
              source_url: { type: ["string", "null"], description: "URL of the source (only when a GROUNDED SOURCE was provided)." },
            },
            required: ["question_type", "topic", "bloom_level", "difficulty", "marks", "stem", "answer", "mark_scheme"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
};

// ---------- AI gateway with retry ----------

async function callAI(messages: Array<{ role: string; content: string }>): Promise<{ ok: boolean; status: number; json?: any; errText?: string }> {
  const aiBody = JSON.stringify({
    model: "google/gemini-2.5-pro",
    messages,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "save_assessment" } },
  });
  let aiResp: Response | null = null;
  let lastErrTxt = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: aiBody,
    });
    if (aiResp.ok) break;
    lastErrTxt = await aiResp.text().catch(() => "");
    const transient = aiResp.status === 502 || aiResp.status === 503 || aiResp.status === 504;
    console.warn(`[generate] AI attempt ${attempt + 1} failed status=${aiResp.status} transient=${transient}`);
    if (!transient) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  if (!aiResp || !aiResp.ok) {
    return { ok: false, status: aiResp?.status ?? 500, errText: lastErrTxt };
  }
  const json = await aiResp.json();
  return { ok: true, status: 200, json };
}

// ---------- Main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      assessmentId, title, subject, level, assessmentType, durationMinutes,
      totalMarks, blueprint, questionTypes, instructions,
      userId: bodyUserId,
      syllabusCode, paperCode,
    } = body;
    const userId = bodyUserId ?? "00000000-0000-0000-0000-000000000001";

    const fallbackTypes = Array.isArray(questionTypes) ? questionTypes : [];
    const sections = toSections(blueprint, "structured", fallbackTypes);
    if (sections.length === 0) {
      return new Response(JSON.stringify({ error: "Blueprint has no sections" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const subjectKind = classifySubject(subject);
    const scienceMathKind = classifyScienceMath(subject);

    // Fetch past-paper exemplars once for the whole paper (style anchor).
    let exemplarBlock = "";
    try {
      const ex = await fetchExemplars(supabase, subject, level);
      exemplarBlock = ex.block;
      console.log(`[generate] exemplars: ${ex.paperCount} papers, ${ex.questionCount} questions`);
    } catch (e) {
      console.warn("[generate] exemplar fetch failed", e);
    }

    // Shared dedup sets so no two questions across the whole paper reuse a source.
    const usedHosts = new Set<string>();
    const usedUrls = new Set<string>();

    type EnrichedRow = {
      assessment_id: string; user_id: string; position: number;
      question_type: string; topic: string | null; bloom_level: string | null;
      difficulty: string | null; marks: number; stem: string;
      options: string[] | null; answer: string | null; mark_scheme: string | null;
      source_excerpt: string | null; source_url: string | null; notes: string | null;
      diagram_url: string | null; diagram_source: string | null;
      diagram_citation: string | null; diagram_caption: string | null;
    };

    const allRows: EnrichedRow[] = [];
    let droppedNoSource = 0;
    let groundedCount = 0;
    let diagramCount = 0;
    let sectionFailures = 0;

    // Pick a topic pool entry, round-robining so all topics in the pool are covered.
    const pickTopic = (s: Section, qIdx: number): SectionTopic | null => {
      if (s.topic_pool.length === 0) return null;
      return s.topic_pool[qIdx % s.topic_pool.length];
    };

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      console.log(`[generate] section ${section.letter} (${section.question_type}) — ${section.num_questions} questions, ${section.marks} marks`);

      // Decide which questions in this section need a grounded source.
      // Humanities + non-essay = always; English + (source_based|comprehension) = always; otherwise none.
      const isHumanitiesNonEssay =
        subjectKind === "humanities" &&
        section.question_type !== "long" &&
        section.question_type !== "structured";
      const isEnglishSourcey =
        subjectKind === "english" &&
        (section.question_type === "source_based" || section.question_type === "comprehension");
      const needsSourcePerQ = isHumanitiesNonEssay || isEnglishSourcey;

      // Pre-fetch grounded sources for each question slot.
      const sourcesForSection: (GroundedSource | null)[] = [];
      if (needsSourcePerQ && subjectKind) {
        for (let qi = 0; qi < section.num_questions; qi++) {
          const t = pickTopic(section, qi);
          if (!t) { sourcesForSection.push(null); continue; }
          try {
            const src = await fetchGroundedSource(subjectKind, t.topic, t.learning_outcomes ?? [], usedHosts, usedUrls);
            sourcesForSection.push(src);
          } catch (e) {
            console.warn("[generate] source fetch failed for", t.topic, e);
            sourcesForSection.push(null);
          }
        }
      } else {
        for (let qi = 0; qi < section.num_questions; qi++) sourcesForSection.push(null);
      }

      // Build prompt + call AI for this section only.
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: buildSystemPrompt(subject, level, paperCode) },
      ];
      if (exemplarBlock) messages.push({ role: "system", content: exemplarBlock });
      messages.push({
        role: "user",
        content: buildSectionUserPrompt({
          title, subject, level, assessmentType, totalMarks, durationMinutes,
          section, sectionIndex: si, totalSections: sections.length,
          syllabusCode, paperCode, groundedSources: sourcesForSection, instructions,
        }),
      });

      const ai = await callAI(messages);
      if (!ai.ok) {
        console.error(`[generate] section ${section.letter} AI error`, ai.status, (ai.errText ?? "").slice(0, 300));
        sectionFailures++;
        continue;
      }
      const toolCall = ai.json?.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) {
        console.error(`[generate] section ${section.letter}: no tool call`, JSON.stringify(ai.json).slice(0, 300));
        sectionFailures++;
        continue;
      }
      let parsed: { questions?: any[] };
      try { parsed = JSON.parse(toolCall.function.arguments); }
      catch { sectionFailures++; continue; }
      const questions = parsed.questions ?? [];

      // Per-question post-processing: enforce source attachment, drop unsupported.
      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi];
        const expectedSrc = sourcesForSection[qi];
        let question_type: string = section.question_type; // FORCE section's type
        let source_excerpt: string | null = q.source_excerpt ?? null;
        let source_url: string | null = q.source_url ?? null;
        let notes: string | null = null;

        if (needsSourcePerQ) {
          if (!expectedSrc) {
            // Could not retrieve a source for a question that requires one — drop it.
            droppedNoSource++;
            continue;
          }
          // Force source_based for humanities so the editor renders the passage UI.
          if (subjectKind === "humanities") question_type = "source_based";
          source_excerpt = expectedSrc.excerpt;
          source_url = expectedSrc.source_url;
          if (q.source_excerpt !== expectedSrc.excerpt) {
            notes = "Source excerpt enforced from retrieved citation (model attempted to alter it).";
          }
          groundedCount++;
        } else {
          // Sections that don't need a source must not carry one.
          source_excerpt = null;
          source_url = null;
        }

        // Diagram cascade for science/math (only for question types that benefit).
        let diag: Awaited<ReturnType<typeof fetchDiagram>> | null = null;
        if (scienceMathKind) {
          const t = pickTopic(section, qi);
          const wantDiagram = questionWantsDiagram(
            scienceMathKind,
            [question_type],
            q.topic ?? t?.topic ?? "",
            t?.learning_outcomes ?? [],
          );
          if (wantDiagram) {
            try {
              diag = await fetchDiagram({
                supabase, kind: scienceMathKind, subject, level,
                topic: q.topic ?? t?.topic ?? "",
                learningOutcomes: t?.learning_outcomes ?? [],
                assessmentId,
              });
              if (diag) diagramCount++;
            } catch (e) {
              console.warn("[generate] diagram fetch failed", e);
            }
          }
        }

        allRows.push({
          assessment_id: assessmentId,
          user_id: userId,
          position: allRows.length,
          question_type,
          topic: q.topic ?? null,
          bloom_level: q.bloom_level ?? section.bloom ?? null,
          difficulty: q.difficulty ?? null,
          marks: q.marks ?? 1,
          stem: q.stem,
          options: q.options ?? null,
          answer: q.answer ?? null,
          mark_scheme: q.mark_scheme ?? null,
          source_excerpt,
          source_url,
          notes,
          diagram_url: diag?.url ?? null,
          diagram_source: diag?.source ?? null,
          diagram_citation: diag?.citation ?? null,
          diagram_caption: diag?.caption ?? null,
        });
      }
    }

    if (droppedNoSource > 0) {
      console.warn(`[generate] dropped ${droppedNoSource} question(s) with no retrievable source`);
    }
    if (sectionFailures > 0) {
      console.warn(`[generate] ${sectionFailures} section(s) failed to generate`);
    }

    if (allRows.length > 0) {
      const { error: insErr } = await supabase.from("assessment_questions").insert(allRows);
      if (insErr) {
        console.error("Insert error", insErr);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (allRows.length === 0 && sectionFailures > 0) {
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable. Please try again in a moment." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      questionCount: allRows.length,
      groundedCount,
      diagramCount,
      droppedNoSource,
      sectionFailures,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
