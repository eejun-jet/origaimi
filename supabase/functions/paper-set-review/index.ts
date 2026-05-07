// Macro coach review for a paper set: aggregates AO mark-share, KO/LO union
// and unrealised outcomes across multiple parsed past papers, then asks the
// AI gateway for a calm 2-4 line observation. Persists each run to
// `paper_set_reviews`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const TOOL = {
  type: "function",
  function: {
    name: "submit_paper_set_review",
    description: "Submit a macro review across a paper set.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "At most 2 sentences. Neutral. May be empty." },
        priority_insights: {
          type: "array",
          description: "1-4 calm one-liners (≤ 25 words each). Empty if nothing material.",
          items: { type: "string" },
        },
        ao_drift: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ao_code: { type: "string" },
              declared_pct: { type: "number" },
              observed_pct: { type: "number" },
              note: { type: "string" },
            },
            required: ["ao_code", "observed_pct", "note"],
            additionalProperties: false,
          },
        },
        unrealised: {
          type: "object",
          properties: {
            kos: { type: "array", items: { type: "string" } },
            los: { type: "array", items: { type: "string" } },
            note: { type: "string" },
          },
          required: ["kos", "los"],
          additionalProperties: false,
        },
      },
      required: ["summary", "priority_insights", "ao_drift", "unrealised"],
      additionalProperties: false,
    },
  },
};

type ParsedQuestion = {
  marks?: number;
  ao_codes?: string[];
  knowledge_outcomes?: string[];
  learning_outcomes?: string[];
  sub_parts?: { marks?: number }[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { set_id } = await req.json();
    if (!set_id) {
      return new Response(JSON.stringify({ error: "set_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: setRow, error: setErr } = await supabase
      .from("paper_sets")
      .select("id,user_id,title,subject,level,syllabus_doc_id,scoped_disciplines")
      .eq("id", set_id)
      .single();
    if (setErr || !setRow) {
      return new Response(JSON.stringify({ error: setErr?.message ?? "Set not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: links } = await supabase
      .from("paper_set_papers")
      .select("paper_id,position")
      .eq("set_id", set_id)
      .order("position");
    const paperIds = ((links as { paper_id: string }[]) ?? []).map((l) => l.paper_id);
    if (paperIds.length === 0) {
      return new Response(JSON.stringify({ error: "Set has no papers" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: papers } = await supabase
      .from("past_papers")
      .select("id,title,paper_number,year,questions_json")
      .in("id", paperIds);

    let aoDefs: { code: string; title: string | null; description: string | null; weighting_percent: number | null }[] = [];
    let topics: { title?: string | null; section: string | null; outcome_categories: string[]; learning_outcomes: string[] }[] = [];
    if (setRow.syllabus_doc_id) {
      const [{ data: aos }, { data: tps }] = await Promise.all([
        supabase
          .from("syllabus_assessment_objectives")
          .select("code,title,description,weighting_percent")
          .eq("source_doc_id", setRow.syllabus_doc_id)
          .order("position"),
        supabase
          .from("syllabus_topics")
          .select("title,section,outcome_categories,learning_outcomes")
          .eq("source_doc_id", setRow.syllabus_doc_id),
      ]);
      aoDefs = (aos as typeof aoDefs) ?? [];
      topics = (tps as typeof topics) ?? [];
    }

    // Aggregate. Skip mark-scheme papers — they duplicate question rows
    // without adding assessment demand.
    const isMarkScheme = (title: string | null | undefined) => {
      const t = (title ?? "").toLowerCase();
      return /\[ms\]|mark\s*scheme|marking\s*scheme/.test(t);
    };
    const allPapers = (papers ?? []) as { id: string; title: string | null; questions_json: unknown }[];
    const qpPapers = allPapers.filter((p) => !isMarkScheme(p.title));
    const papersUsed = qpPapers.length;
    const papersSkipped = allPapers.length - qpPapers.length;

    const aoMarks = new Map<string, number>();
    const kosSeen = new Set<string>();
    const losSeen = new Set<string>();
    let totalMarks = 0;
    let totalQuestions = 0;
    let unclassifiedQuestions = 0;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,!?\s]+$/g, "").trim();

    for (const p of qpPapers) {
      const arr = Array.isArray(p.questions_json) ? (p.questions_json as ParsedQuestion[]) : [];
      for (const q of arr) {
        totalQuestions++;
        const subSum = (q.sub_parts ?? []).reduce((s, sp) => s + (sp.marks ?? 0), 0);
        const m = subSum > 0 ? subSum : (q.marks ?? 0);
        totalMarks += m;
        const codes = (q.ao_codes ?? []).filter(Boolean);
        if (codes.length > 0) {
          const per = m / codes.length;
          for (const c of codes) aoMarks.set(c, (aoMarks.get(c) ?? 0) + per);
        } else {
          unclassifiedQuestions++;
        }
        for (const k of q.knowledge_outcomes ?? []) if (k) kosSeen.add(k.trim());
        for (const l of q.learning_outcomes ?? []) if (l) losSeen.add(norm(l));
      }
    }

    // Discipline scoping (e.g. Combined Science where only 2 of 3 sciences
    // are tested) — drop unrealised KOs/LOs from disciplines that aren't in
    // scope so we don't tell the teacher Biology is "untested" when it
    // wasn't in the assessment at all.
    const normDiscipline = (s: string | null | undefined): string => {
      if (!s) return "General";
      const t = s.toLowerCase();
      if (t.includes("physic")) return "Physics";
      if (t.includes("chem")) return "Chemistry";
      if (t.includes("bio")) return "Biology";
      if (t.includes("practical") || t.includes("experimental")) return "Practical";
      return s.split(/[—–-]/).slice(-1)[0]?.trim() || s;
    };
    const koDisc = new Map<string, string>();
    const loDisc = new Map<string, string>();
    const universe = new Set<string>();
    for (const t of topics) {
      const d = normDiscipline(t.section ?? null);
      universe.add(d);
      for (const k of t.outcome_categories ?? []) if (k && !koDisc.has(k)) koDisc.set(k.trim(), d);
      for (const l of t.learning_outcomes ?? []) if (l && !loDisc.has(l)) loDisc.set(l, d);
    }
    let inScope: Set<string> | null = null;
    if (universe.size >= 2) {
      const override = (setRow as { scoped_disciplines?: string[] | null }).scoped_disciplines ?? null;
      if (override && override.length > 0) {
        inScope = new Set(override.map(normDiscipline));
        inScope.add("General");
      } else {
        const detected = new Set<string>();
        for (const p of qpPapers) {
          const arr = Array.isArray(p.questions_json) ? (p.questions_json as ParsedQuestion[]) : [];
          for (const q of arr) {
            for (const k of q.knowledge_outcomes ?? []) {
              const d = koDisc.get((k ?? "").trim()); if (d) detected.add(d);
            }
            for (const l of q.learning_outcomes ?? []) {
              const d = loDisc.get(l ?? ""); if (d) detected.add(d);
            }
          }
        }
        if (detected.size === 0) inScope = new Set(universe);
        else { detected.add("General"); inScope = detected; }
      }
    }

    const allKOs = new Set<string>();
    const allLOs = new Map<string, string>(); // norm -> original
    for (const t of topics) {
      for (const k of t.outcome_categories ?? []) if (k) allKOs.add(k.trim());
      for (const l of t.learning_outcomes ?? []) if (l) allLOs.set(norm(l), l);
    }
    const koInScope = (k: string) => !inScope || inScope.has(koDisc.get(k) ?? "General");
    const loInScope = (origLo: string) => !inScope || inScope.has(loDisc.get(origLo) ?? "General");
    const unrealisedKOs = Array.from(allKOs).filter((k) => !kosSeen.has(k) && koInScope(k));
    const unrealisedLOs = Array.from(allLOs.entries())
      .filter(([k, v]) => !losSeen.has(k) && loInScope(v))
      .map(([, v]) => v);
    const scopeNote = inScope
      ? `Scope filter active: only ${Array.from(inScope).filter((d) => d !== "General").join(", ")} are in scope.`
      : "";

    const aoStats = Array.from(new Set([...aoDefs.map((a) => a.code), ...aoMarks.keys()])).map((code) => {
      const def = aoDefs.find((a) => a.code === code);
      const observed = totalMarks > 0 ? ((aoMarks.get(code) ?? 0) / totalMarks) * 100 : 0;
      return {
        code,
        observed_pct: Number(observed.toFixed(1)),
        declared_pct: def?.weighting_percent ?? null,
        title: def?.title ?? null,
        description: def?.description ?? null,
      };
    });

    const sys = `You are the macro Assessment Review Coach for a Singapore secondary teacher. They have grouped ${paperIds.length} past papers (${setRow.subject ?? ""} ${setRow.level ?? ""}) and want a calm overview of demand and coverage across the set as a whole — not paper-by-paper feedback.

VOICE — hard rules:
- No praise (no "great", "excellent", "well done").
- No verdicts (no "weak", "lacks rigour", "poor").
- Observations over judgements. British spelling. Singapore phrasing. Plain language.
- One excellent insight beats ten average ones. Empty arrays are fine.

WHAT TO PRODUCE:
- summary: at most 2 sentences. May be empty if priority_insights already carries the signal.
- priority_insights: 1–4 calm one-liners (≤ 25 words each), ranked by impact on the teacher's next decision.
- ao_drift: for each AO whose observed share differs from the declared weighting by > 8 pp (or declared is missing and the share is conspicuously low/high), one entry with a one-line note.
- unrealised: list KOs and LOs from the syllabus that no question in the set exercises. Truncate each list to at most 12 items (most pedagogically central first); add a one-line note summarising the gap if you do.

${scopeNote ? `\nSCOPE: ${scopeNote} Do NOT recommend coverage for out-of-scope disciplines and do NOT flag any of their KOs/LOs as gaps.\n` : ""}
Submit STRICTLY through the submit_paper_set_review tool.`;

    const userPayload = {
      set: { title: setRow.title, subject: setRow.subject, level: setRow.level, paper_count: papersUsed, mark_schemes_skipped: papersSkipped, total_questions: totalQuestions, total_marks: totalMarks },
      ao_definitions: aoDefs,
      ao_observed: aoStats,
      unrealised_candidates: {
        kos: unrealisedKOs.slice(0, 50),
        los: unrealisedLOs.slice(0, 80),
      },
    };

    const model = "google/gemini-2.5-flash";
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Review this paper set and submit findings via the tool.\n\n${JSON.stringify(userPayload)}` },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "submit_paper_set_review" } },
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
      const t = await aiResp.text();
      console.error("paper-set-review AI error:", aiResp.status, t);
      return new Response(JSON.stringify({ error: "Macro coach is temporarily unavailable. Please retry." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let findings: Record<string, unknown> = {};
    if (toolCall?.function?.arguments) {
      try { findings = JSON.parse(toolCall.function.arguments); }
      catch (e) { console.error("paper-set-review: bad tool args", e); }
    }

    const ranAt = new Date().toISOString();
    const snapshot = {
      kind: "paper_set_review",
      ran_at: ranAt,
      model,
      total_marks: totalMarks,
      total_questions: totalQuestions,
      papers_used: papersUsed,
      papers_skipped: papersSkipped,
      unclassified_questions: unclassifiedQuestions,
      findings,
    };
    const { data: stored } = await supabase
      .from("paper_set_reviews")
      .insert({ set_id, user_id: setRow.user_id, ran_at: ranAt, model, snapshot })
      .select("id")
      .single();

    return new Response(
      JSON.stringify({
        run_id: (stored as { id: string } | null)?.id ?? null,
        ran_at: ranAt,
        model,
        findings,
        papers_used: papersUsed,
        papers_skipped: papersSkipped,
        total_questions: totalQuestions,
        total_marks: totalMarks,
        unclassified_questions: unclassifiedQuestions,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("paper-set-review fatal:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
