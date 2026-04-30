// Assessment Coach — runs 7 review checks against a generated paper and
// returns structured findings. Persists each run as a row in
// `assessment_versions` (label='coach:<isoTimestamp>', snapshot=findings)
// so teachers can compare iterations after they edit the paper.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { expandQuestionTags } from "./coverage-infer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const COACH_TOOL = {
  type: "function",
  function: {
    name: "submit_coach_review",
    description: "Submit the structured Assessment Coach review covering all 7 checks.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentence headline verdict for the teacher." },
        ao_drift: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ao_code: { type: "string" },
              declared_pct: { type: "number" },
              observed_pct: { type: "number" },
              delta_pct: { type: "number" },
              severity: { type: "string", enum: ["info", "warn", "fail"] },
              note: { type: "string" },
            },
            required: ["ao_code", "observed_pct", "severity", "note"],
            additionalProperties: false,
          },
        },
        unrealised_outcomes: {
          type: "object",
          properties: {
            kos: { type: "array", items: { type: "string" } },
            los: { type: "array", items: { type: "string" } },
            note: { type: "string" },
          },
          required: ["kos", "los", "note"],
          additionalProperties: false,
        },
        source_fit_issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_id: { type: "string" },
              position: { type: "number" },
              required_skill: { type: "string" },
              source_type: { type: "string" },
              severity: { type: "string", enum: ["info", "warn", "fail"] },
              note: { type: "string" },
            },
            required: ["question_id", "position", "severity", "note"],
            additionalProperties: false,
          },
        },
        mark_scheme_flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_id: { type: "string" },
              position: { type: "number" },
              marks_declared: { type: "number" },
              marks_suggested: { type: "number" },
              severity: { type: "string", enum: ["info", "warn", "fail"] },
              note: { type: "string" },
            },
            required: ["question_id", "position", "marks_declared", "severity", "note"],
            additionalProperties: false,
          },
        },
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_id: { type: "string", description: "May be empty for paper-wide suggestions." },
              position: { type: "number" },
              rewrite: { type: "string", description: "A one-line rewrite the teacher can accept." },
              rationale: { type: "string" },
              category: {
                type: "string",
                enum: ["ao", "ko_lo", "source_fit", "marks", "other"],
              },
            },
            required: ["rewrite", "rationale", "category"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "summary",
        "ao_drift",
        "unrealised_outcomes",
        "source_fit_issues",
        "mark_scheme_flags",
        "suggestions",
      ],
      additionalProperties: false,
    },
  },
};

const HUMANITIES_KEYWORDS = ["history", "humanit", "social studies", "geograph"];
const isHumanities = (subject: string | null | undefined) =>
  !!subject && HUMANITIES_KEYWORDS.some((k) => subject.toLowerCase().includes(k));

const SCIENCE_KEYWORDS = ["science", "physics", "chemistry", "biology"];
const isScience = (subject: string | null | undefined) =>
  !!subject && SCIENCE_KEYWORDS.some((k) => subject.toLowerCase().includes(k));

const isCombinedScience = (subject: string | null | undefined, code: string | null | undefined) => {
  const s = (subject ?? "").toLowerCase();
  const c = (code ?? "").trim();
  return /combined\s*science/.test(s) || c === "5086";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const assessmentId: string | undefined = body.assessmentId;
    if (!assessmentId) {
      return new Response(JSON.stringify({ error: "assessmentId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: assessment, error: aErr }, { data: questions, error: qErr }] = await Promise.all([
      supabase.from("assessments").select("*").eq("id", assessmentId).single(),
      supabase.from("assessment_questions").select("*").eq("assessment_id", assessmentId).order("position"),
    ]);

    if (aErr || !assessment) {
      return new Response(JSON.stringify({ error: "Assessment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (qErr || !questions || questions.length === 0) {
      return new Response(
        JSON.stringify({ error: "This paper has no questions yet — generate it first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let aoDefs: { code: string; title: string | null; description: string | null; weighting_percent: number | null }[] = [];
    if (assessment.syllabus_doc_id) {
      const { data } = await supabase
        .from("syllabus_assessment_objectives")
        .select("code,title,description,weighting_percent")
        .eq("source_doc_id", assessment.syllabus_doc_id)
        .order("position");
      aoDefs = (data ?? []) as typeof aoDefs;
    }

    const totalActual = (questions as any[]).reduce((s: number, q: any) => s + (q.marks ?? 0), 0);
    const isHum = isHumanities(assessment.subject);

    const sectionedBlueprint = Array.isArray(assessment.blueprint) ? assessment.blueprint : [];

    // Map question position → section so we can pull the right LO/KO/AO pool.
    const sectionByPos: any[] = [];
    for (const s of sectionedBlueprint as any[]) {
      const n = s?.num_questions ?? 0;
      for (let i = 0; i < n; i++) sectionByPos.push(s);
    }
    const isSci = isScience(assessment.subject);
    const isCombSci = isCombinedScience(assessment.subject, assessment.syllabus_code);
    const inferKind: "humanities" | "english" | "science_math" | "other" = isHum ? "humanities" : (isSci ? "science_math" : "science_math");

    const compactQuestions = (questions as any[]).map((q) => {
      const sec = sectionByPos[q.position] ?? null;
      const poolAOs = sec
        ? (Array.isArray(sec.ao_codes) && sec.ao_codes.length > 0
            ? sec.ao_codes
            : Array.from(new Set((sec.topic_pool ?? []).flatMap((t: any) => t?.ao_codes ?? []))))
        : [];
      const poolKOs = sec
        ? (Array.isArray(sec.knowledge_outcomes) && sec.knowledge_outcomes.length > 0
            ? sec.knowledge_outcomes
            : Array.from(new Set((sec.topic_pool ?? []).flatMap((t: any) => t?.outcome_categories ?? []))))
        : [];
      const poolLOs = sec
        ? (Array.isArray(sec.learning_outcomes) && sec.learning_outcomes.length > 0
            ? sec.learning_outcomes
            : Array.from(new Set((sec.topic_pool ?? []).flatMap((t: any) => t?.learning_outcomes ?? []))))
        : [];
      const expanded = expandQuestionTags(
        { stem: q.stem ?? "", answer: q.answer ?? null, mark_scheme: q.mark_scheme ?? null, topic: q.topic ?? null, options: Array.isArray(q.options) ? q.options : null },
        { ao_codes: q.ao_codes ?? [], knowledge_outcomes: q.knowledge_outcomes ?? [], learning_outcomes: q.learning_outcomes ?? [] },
        { loPool: poolLOs as string[], koPool: poolKOs as string[], aoPool: poolAOs as string[] },
        inferKind,
      );
      return {
        id: q.id,
        position: q.position,
        type: q.question_type,
        topic: q.topic,
        bloom: q.bloom_level,
        difficulty: q.difficulty,
        marks: q.marks,
        stem: typeof q.stem === "string" ? q.stem.slice(0, 1200) : "",
        options: q.options ?? null,
        mark_scheme: typeof q.mark_scheme === "string" ? q.mark_scheme.slice(0, 600) : null,
        ao_codes: expanded.ao_codes,
        knowledge_outcomes: expanded.knowledge_outcomes,
        learning_outcomes: expanded.learning_outcomes,
        source_excerpt: typeof q.source_excerpt === "string" ? q.source_excerpt.slice(0, 600) : null,
        source_url: q.source_url ?? null,
      };
    });

    const subjectKindLabel = isHum ? "humanities" : (isSci ? "science" : "general");
    const sciencePackBlock = isSci ? `

SCIENCE-SPECIFIC RUBRIC (apply IN ADDITION to the 7 generic checks below; fold findings into the existing arrays):

S1. Quantitative rigour — every calculation item must (a) state units explicitly in the stem, (b) give the answer to a sensible number of significant figures in the mark scheme (typically 2–3 s.f.), (c) award method marks (M) AND accuracy mark(s) (A) in the working, not a single lump sum. Flag missing units, wrong s.f., or mark schemes that only show a final numeric answer with no working under 'mark_scheme_flags'.

S2. MCQ distractor quality — for every MCQ, check that: exactly one option is unambiguously correct; distractors reflect plausible misconceptions (not throwaway nonsense); no use of "All of the above" / "None of the above"; option lengths are roughly comparable; no grammatical clue from stem to one option. Flag bad distractors via 'command_word_issues' (use detected_verb="MCQ_distractor").

S3. Practical-skills coverage (papers tagged with C1–C6 / a Practical section) — verify that the practical-skill AOs declared on the paper (e.g. C1 Planning, C2 Manipulation, C3 Observation, C4 Recording, C5 Interpretation, C6 Evaluation) are each exercised by at least one question. Treat any uncovered C-codes as 'unrealised_outcomes.kos' entries with note prefixed "Practical skill not exercised: …".

S4. Command-word fit for sciences — AO1 verbs: state, define, list, name, identify, recall. AO2 verbs: calculate, explain, describe (a process), predict, apply, deduce, suggest. AO3 verbs: analyse, evaluate, compare, justify, design (an experiment), criticise, decide. Flag mismatches via 'command_word_issues'.

S5. Source/data-handling questions in sciences (graphs, tables, photographs, experimental data) — when a stem references a figure or dataset, ensure the answer/mark scheme actually depends on that data (not generic recall that ignores the figure). Treat as 'source_fit_issues' with required_skill="data_handling" and source_type="figure"|"table"|"experimental".
${isCombSci ? `
S6. Combined Science Paper 1 (5086 MCQ) discipline balance — Paper 1 is 40 MCQs split 20 Physics + 20 Chemistry. If the section is MCQ and num_questions ≥ 20, count questions whose topic / tags clearly belong to Physics vs Chemistry. Flag any imbalance > 2 questions away from the 50/50 split as a 'bloom_curve' finding (use section_letter of the MCQ section, observed_progression="Physics=N, Chemistry=M", severity=fail when off by > 4).
` : ""}` : "";

    const sys = `You are an experienced Singapore MOE Head of Department reviewing a junior teacher's draft assessment for ${assessment.level} ${assessment.subject}${isCombSci ? " (combined-science paper — Physics + Chemistry components)" : ""}.
Your job is the Assessment Literacy Coach. Be candid but constructive — no empty praise. Use British spelling and Singapore phrasing. This paper is a ${subjectKindLabel} paper.

Run all 7 checks and submit your findings via the submit_coach_review tool:

1. AO drift — for each declared AO, compare its syllabus weighting % against the actual mark share of questions tagged with it. Flag deltas > 8 pp as warn and > 15 pp as fail. Also flag questions whose AO tag is too generous (stem only requires AO1 recall but tagged AO2/AO3).

2. Command-word audit — extract the leading verb of each stem and judge whether it matches the declared AO. ${
      isHum
        ? "For History/Humanities: infer/compare/how-similar/how-different/how-far → AO3; describe/identify → AO1; explain/account-for → AO2."
        : "For Sciences (Physics, Chemistry, Biology, Combined Science): AO1 = recall (state, define, list, name, identify); AO2 = apply (calculate, explain, describe a process, predict, deduce, suggest); AO3 = analyse / evaluate (compare, justify, design an experiment, criticise, decide). Practical AOs C1–C6 cover planning, manipulation, observation, recording, interpretation and evaluation respectively."
    }

3. KO/LO realisation — list every KO and LO ticked on the paper or its sections that no question actually exercises. The ao_codes / knowledge_outcomes / learning_outcomes arrays you receive on each question already include both the teacher-confirmed tags AND outcomes that the stem text demonstrably exercises (a multi-part question normally covers 2–4 LOs). Treat any LO/KO present on those arrays as covered. Only flag an LO/KO as unrealised when NO question's stem, sub-parts or model answer demonstrates it. Skip outcomes that are adequately covered.

4. Bloom & difficulty curve — per section, check the question-by-question Bloom and difficulty ramp. Flag clustering (e.g. 4 recall items in a row) or anti-progression (hard before easy).

5. Source-question fit. ${
      isHum
        ? "Humanities paper — for each source-based question, judge whether the cited source actually supports the demanded skill: a 'purpose' question needs clear authorship/context; a 'compare' question needs two sources with non-trivial similarity/difference; an 'infer' question needs implicit content not on the surface."
        : (isSci
            ? "Science paper — only flag questions that present a figure, table, graph or experimental dataset and whose answer should depend on reading that stimulus. Flag when the stem references a figure but the mark scheme is generic recall that ignores the data. Use required_skill='data_handling' and source_type one of 'figure' | 'table' | 'experimental'. If no data-handling questions appear, return an empty array."
            : "This paper is neither humanities nor science — return an empty array.")
    }

6. Mark-scheme realism — for each question, judge whether marks_declared matches the cognitive demand and command word. Suggest marks_suggested when it is off by ≥ 1.${isSci ? " For science calculations, also penalise mark schemes that lump method + accuracy into one mark, omit units, or quote the final answer to too many / too few significant figures." : ""}

7. Suggestions — for every fail or warn, attach at most ONE one-line "Try: …" rewrite that the teacher can apply. Keep rewrites in the same question type and within ±1 mark of the original.${sciencePackBlock}

Return STRICTLY through the tool. Do not include prose outside the tool call. If a check has no findings, return an empty array (not omitted).`;

    const userPayload = {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        subject: assessment.subject,
        level: assessment.level,
        syllabus_code: assessment.syllabus_code ?? null,
        total_marks: assessment.total_marks,
        total_actual_marks: totalActual,
        instructions: assessment.instructions ?? null,
        sections: sectionedBlueprint,
      },
      ao_definitions: aoDefs,
      questions: compactQuestions,
    };

    const user = `Review this paper and submit findings via the tool.\n\n${JSON.stringify(userPayload)}`;
    // Flash is ~5× faster than Pro at this task and still strong on
    // tool-call structured output. Switch to Pro if quality complaints come up.
    const model = "google/gemini-2.5-flash";

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [COACH_TOOL],
        tool_choice: { type: "function", function: { name: "submit_coach_review" } },
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a minute." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Top up to continue." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error("coach-review AI error:", aiResp.status, errTxt);
      return new Response(
        JSON.stringify({ error: "Coach is temporarily unavailable. Please retry." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("coach-review: no tool call returned", JSON.stringify(aiJson).slice(0, 500));
      return new Response(JSON.stringify({ error: "Coach returned no findings — try again." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let findings: any;
    try {
      findings = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("coach-review: bad tool args", e);
      return new Response(JSON.stringify({ error: "Coach output was malformed — try again." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ranAt = new Date().toISOString();
    const { data: stored, error: storeErr } = await supabase
      .from("assessment_versions")
      .insert({
        assessment_id: assessmentId,
        user_id: assessment.user_id,
        label: `coach:${ranAt}`,
        snapshot: {
          kind: "coach_review",
          model,
          ran_at: ranAt,
          total_actual_marks: totalActual,
          total_marks: assessment.total_marks,
          findings,
        },
      })
      .select("id, created_at")
      .single();

    if (storeErr) {
      console.error("coach-review: persist failed", storeErr);
    }

    return new Response(
      JSON.stringify({
        run_id: stored?.id ?? null,
        ran_at: ranAt,
        model,
        total_actual_marks: totalActual,
        findings,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("coach-review fatal:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
