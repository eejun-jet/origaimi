// Assessment Coach — runs 7 review checks against a generated paper and
// returns structured findings. Persists each run as a row in
// `assessment_versions` (label='coach:<isoTimestamp>', snapshot=findings)
// so teachers can compare iterations after they edit the paper.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { expandQuestionTags } from "./coverage-infer.ts";
import { computeFingerprint, diffFingerprints, type DifficultyFingerprint, type FingerprintQuestion } from "./fingerprint.ts";

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
        summary: {
          type: "string",
          description:
            "At most 2 sentences. Neutral, observation-led. No praise words ('great', 'excellent'), no verdicts ('weak', 'lacks rigour'). May be empty if priority_insights already says it.",
        },
        priority_insights: {
          type: "array",
          description:
            "1–3 short, calm headline insights, ranked by impact on the teacher's next decision. Each ≤ 25 words. Plain observation, not praise. Empty array if nothing material.",
          items: { type: "string" },
        },
        cognitive_demand: {
          type: "object",
          description:
            "Optional. ONE observation on the recall vs application vs analysis spread. Omit if balanced.",
          properties: {
            severity: { type: "string", enum: ["info", "warn"] },
            note: { type: "string" },
            suggestion: { type: "string", description: "Optional one-line nudge." },
          },
          required: ["severity", "note"],
          additionalProperties: false,
        },
        question_variety: {
          type: "object",
          description:
            "Optional. ONE observation on command-verb diversity, item-format mix, or reading load. Omit if varied.",
          properties: {
            severity: { type: "string", enum: ["info", "warn"] },
            note: { type: "string" },
            suggestion: { type: "string", description: "Optional one-line nudge." },
          },
          required: ["severity", "note"],
          additionalProperties: false,
        },
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
        "priority_insights",
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

SCIENCE-SPECIFIC RUBRIC (apply IN ADDITION to the generic checks below; fold findings into the existing arrays):

S1. Quantitative rigour — every calculation item must (a) state units explicitly in the stem, (b) give the answer to a sensible number of significant figures in the mark scheme (typically 2–3 s.f.), (c) award method marks (M) AND accuracy mark(s) (A) in the working, not a single lump sum. Flag missing units, wrong s.f., or mark schemes that only show a final numeric answer with no working under 'mark_scheme_flags'.

S2. Practical-skills coverage (papers tagged with C1–C6 / a Practical section) — verify that the practical-skill AOs declared on the paper (e.g. C1 Planning, C2 Manipulation, C3 Observation, C4 Recording, C5 Interpretation, C6 Evaluation) are each exercised by at least one question. Treat any uncovered C-codes as 'unrealised_outcomes.kos' entries with note prefixed "Practical skill not exercised: …".

S3. Source/data-handling questions in sciences (graphs, tables, photographs, experimental data) — when a stem references a figure or dataset, ensure the answer/mark scheme actually depends on that data (not generic recall that ignores the figure). Treat as 'source_fit_issues' with required_skill="data_handling" and source_type="figure"|"table"|"experimental".
` : "";

    const isPastPaperAnalysis = (assessment as { assessment_type?: string | null }).assessment_type === "past_paper_analysis";
    const analysisPreamble = isPastPaperAnalysis
      ? "\n\nThis paper was IMPORTED FROM AN EXISTING PAST PAPER and the teacher wants a critique of it (not a draft to rewrite). Frame findings as observations about the paper's coverage, balance and demand. Skip 'rewrite the stem' suggestions; instead note 'Consider replacing/dropping' or 'Add a follow-up question that…' when something is missing."
      : "";

    const sys = `You are the Assessment Review Coach for a Singapore secondary teacher reviewing a draft ${assessment.level} ${assessment.subject}${isCombSci ? " (combined-science paper — Physics + Chemistry components)" : ""} paper.${analysisPreamble}

You are reviewing the assessment, not the teacher. Behave like a thoughtful moderation partner — calm, quietly competent, grounded. Not an examiner writing evaluation comments.

VOICE — hard rules:
- No praise language. Never write "great", "excellent", "fantastic", "well done", "good job", "strong assessment".
- No verdicts. Never write "weak", "lacks rigour", "not rigorous", "poor", "lacks higher-order thinking".
- Prefer observations over judgements. e.g. "Most questions currently assess direct retrieval." / "Adding one unfamiliar application task may better distinguish stronger students." / "This paper covers content knowledge well; data interpretation is lighter."
- British spelling. Singapore phrasing. Plain language. No AI enthusiasm.
- One excellent insight beats ten average ones. If a check has nothing material, return an empty array — do not pad.

PRIORITISATION:
- Rank findings by impact on the teacher's next decision, not by check order.
- Populate \`priority_insights\` with the top 1–3 calm one-liners (≤ 25 words each). These are the headline. If everything is in shape, return an empty array.
- Keep \`summary\` to at most 2 sentences, observation-led. May be empty when priority_insights already carries the signal.

SYLLABUS-AS-PHILOSOPHY:
When AO definitions are present, treat the syllabus as a cognitive framework — assessment objectives, command-term expectations, intended reasoning balance, expected disciplinary practices — not a topic checklist. Sound grounded, not preachy. Do not quote syllabus prose.

Submit your findings via the submit_coach_review tool. Run these checks:

1. AO drift — for each declared AO, compare its syllabus weighting % against the actual mark share of questions tagged with it. Flag deltas > 8 pp as warn and > 15 pp as fail. Also flag questions whose AO tag is too generous (stem only requires AO1 recall but tagged AO2/AO3).

2. KO/LO realisation — list every KO and LO ticked on the paper or its sections that no question actually exercises. The ao_codes / knowledge_outcomes / learning_outcomes arrays you receive on each question already include both the teacher-confirmed tags AND outcomes that the stem text demonstrably exercises (a multi-part question normally covers 2–4 LOs). Treat any LO/KO present on those arrays as covered. Only flag an LO/KO as unrealised when NO question's stem, sub-parts or model answer demonstrates it. Skip outcomes that are adequately covered.

3. Source-question fit. ${
      isHum
        ? "Humanities paper — for each source-based question, judge whether the cited source actually supports the demanded skill: a 'purpose' question needs clear authorship/context; a 'compare' question needs two sources with non-trivial similarity/difference; an 'infer' question needs implicit content not on the surface."
        : (isSci
            ? "Science paper — only flag questions that present a figure, table, graph or experimental dataset and whose answer should depend on reading that stimulus. Flag when the stem references a figure but the mark scheme is generic recall that ignores the data. Use required_skill='data_handling' and source_type one of 'figure' | 'table' | 'experimental'. If no data-handling questions appear, return an empty array."
            : "This paper is neither humanities nor science — return an empty array.")
    }

4. Mark-scheme realism — for each question, judge whether marks_declared matches the cognitive demand. Suggest marks_suggested when it is off by ≥ 1.${isSci ? " For science calculations, also penalise mark schemes that lump method + accuracy into one mark, omit units, or quote the final answer to too many / too few significant figures." : ""}

   HARD RULE — MCQ: Multiple-choice items follow the convention "1 mark per question" unless the teacher's instructions explicitly say otherwise. Do NOT propose mark-scheme changes for MCQ questions. Never emit a mark_scheme_flags entry, marks_suggested value, or "calculation mark scheme should specify method/units" suggestion for an MCQ. Score MCQs only on stem quality and answer correctness.

5. Suggestions — for every fail or warn, attach at most ONE one-line "Try: …" rewrite that the teacher can apply. Keep rewrites in the same question type and within ±1 mark of the original. Skip suggestions whose value is marginal — silence is better than filler.

6. Cognitive demand (optional, single observation) — if the recall / application / analysis spread is materially skewed, populate \`cognitive_demand\` with a calm one-liner. Omit the field entirely if the spread is reasonable.

7. Question variety (optional, single observation) — if command-verb diversity, item-format mix or reading load is notably narrow or heavy, populate \`question_variety\` with one observation. Omit if varied.

   HARD RULE — fixed-format papers: If the paper's section blueprint constrains every question to a single question_type (e.g. an MCQ-only Paper 1, a structured-only Paper 2), the format is fixed by the syllabus. Do NOT recommend adding other question types (no "include short-answer", "introduce structured tasks", "diversify with essays" etc.). You may still observe command-verb, context, or reading-load variation within the chosen format.${sciencePackBlock}${(() => {
  // Discipline scope hint — only applies to multi-discipline subjects (e.g. Combined Science).
  const ovr = (assessment as { scoped_disciplines?: string[] | null }).scoped_disciplines ?? null;
  const universe = new Set<string>();
  for (const s of (sectionedBlueprint as any[])) {
    for (const t of (s?.topic_pool ?? [])) {
      const sec = t?.section ?? null;
      if (!sec) continue;
      const tt = String(sec).toLowerCase();
      if (tt.includes("physic")) universe.add("Physics");
      else if (tt.includes("chem")) universe.add("Chemistry");
      else if (tt.includes("bio")) universe.add("Biology");
    }
  }
  if (universe.size < 2) return "";
  let scope: string[] | null = null;
  if (ovr && ovr.length > 0) scope = ovr;
  else {
    const detected = new Set<string>();
    for (const q of compactQuestions) {
      const blob = `${q.topic ?? ""} ${(q.knowledge_outcomes ?? []).join(" ")} ${(q.learning_outcomes ?? []).join(" ")}`.toLowerCase();
      if (blob.includes("physic")) detected.add("Physics");
      if (blob.includes("chem")) detected.add("Chemistry");
      if (blob.includes("bio") || blob.includes("organism") || blob.includes("cell")) detected.add("Biology");
    }
    if (detected.size > 0) scope = Array.from(detected);
  }
  if (!scope || scope.length === 0) return "";
  return `\n\nDISCIPLINE SCOPE: This paper only assesses ${scope.join(" + ")}. Do NOT flag KOs, LOs or topics from other disciplines as unrealised or untested — they are out of scope and not expected to appear.`;
})()}

Return STRICTLY through the tool. Do not include prose outside the tool call. For required array fields, return an empty array when there is nothing material — do not invent findings.`;

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

    // Belt-and-braces server-side filtering: even if the model ignores the
    // hard-rule prompt above, strip nonsensical findings before the teacher
    // sees them.
    try {
      const qById = new Map<string, any>((questions as any[]).map((q) => [q.id, q]));
      const qByPos = new Map<number, any>((questions as any[]).map((q) => [q.position, q]));
      const isMcqQ = (qid?: string, pos?: number) => {
        const q = (qid && qById.get(qid)) || (typeof pos === "number" && qByPos.get(pos)) || null;
        return q?.question_type === "mcq";
      };

      // (a) Drop mark-scheme flags / mark-related suggestions for MCQ items.
      if (Array.isArray(findings.mark_scheme_flags)) {
        findings.mark_scheme_flags = findings.mark_scheme_flags.filter(
          (f: any) => !isMcqQ(f?.question_id, f?.position),
        );
      }
      if (Array.isArray(findings.suggestions)) {
        findings.suggestions = findings.suggestions.filter((s: any) => {
          if (!isMcqQ(s?.question_id, s?.position)) return true;
          // Keep MCQ suggestions only if they're not about marks/mark-scheme.
          if (s?.category === "marks") return false;
          const blob = `${s?.rewrite ?? ""} ${s?.rationale ?? ""}`.toLowerCase();
          if (/mark scheme|method and final answer|units|significant figures|s\.f\.|\bmarks?\b.*(suggest|increase|reduce|raise|drop)/.test(blob)) return false;
          return true;
        });
      }

      // (b) Suppress "diversify question types" on a fixed-format paper.
      const uniqueTypes = new Set((questions as any[]).map((q) => q?.question_type).filter(Boolean));
      if (uniqueTypes.size <= 1 && findings.question_variety) {
        const blob = `${findings.question_variety?.note ?? ""} ${findings.question_variety?.suggestion ?? ""}`.toLowerCase();
        if (/multiple-choice|short answer|short-answer|structured|essay|open-ended|diversif|introduc|includ|broaden|range of (response|item|question)/.test(blob)) {
          delete findings.question_variety;
        }
      }
    } catch (filterErr) {
      console.warn("coach-review: post-filter step failed", filterErr);
    }

    // Calibration vs specimen — deterministic, no AI cost. Pull the most
    // recent specimen paper for this subject + level (if any), compute the
    // observed paper's fingerprint, and diff. Result merged into findings so
    // the frontend can render it as a Coach section.
    try {
      const subj = (assessment as any).subject ?? null;
      const lvl = (assessment as any).level ?? null;
      let specimenFp: DifficultyFingerprint | null = null;
      let specimenTitle: string | undefined;
      if (subj && lvl) {
        const { data: specRows } = await supabase
          .from("past_papers")
          .select("id, title, paper_number, notes, difficulty_fingerprint")
          .eq("subject", subj)
          .eq("level", lvl)
          .eq("parse_status", "ready")
          .not("difficulty_fingerprint", "is", null)
          .limit(20);
        const specimenMatch = (specRows ?? []).find((r: any) => {
          const hay = `${r.title ?? ""} ${r.notes ?? ""} ${r.paper_number ?? ""}`.toLowerCase();
          return /(specimen|sample|exemplar)/.test(hay);
        }) ?? (specRows ?? [])[0] ?? null;
        if (specimenMatch?.difficulty_fingerprint) {
          specimenFp = specimenMatch.difficulty_fingerprint as DifficultyFingerprint;
          specimenTitle = specimenMatch.title ?? undefined;
        }
      }
      const observedQs: FingerprintQuestion[] = (questions as any[]).map((q) => ({
        marks: q.marks ?? null,
        command_word: null,
        stem: q.stem ?? null,
        bloom_level: q.bloom_level ?? null,
        ao_codes: Array.isArray(q.ao_codes) ? q.ao_codes : [],
        sub_parts: null,
      }));
      const observedFp = computeFingerprint(observedQs, {
        title: assessment.title ?? null,
        notes: null,
        paper_number: null,
      });
      findings.calibration = diffFingerprints(specimenFp, observedFp, specimenTitle);
    } catch (calErr) {
      console.warn("coach-review: calibration step failed", calErr);
      findings.calibration = {
        has_specimen: false,
        bloom_drift: [],
        ao_drift: [],
        marks_shape_drift: [],
        command_word_gaps: [],
        severity: "info",
        note: "Calibration step skipped due to an error.",
      };
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
