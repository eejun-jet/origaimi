import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Layers, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  inferInScopeDisciplines,
  buildDisciplineLookup,
  normaliseDiscipline,
} from "@/lib/discipline-scope";

export const Route = createFileRoute("/paper-set/$id")({
  component: PaperSetView,
  head: () => ({ meta: [{ title: "Paper set coverage · origAImi" }] }),
});

type ParsedQuestion = {
  number: string;
  marks?: number;
  question_type?: string;
  topic?: string | null;
  topic_code?: string | null;
  ao_codes?: string[];
  knowledge_outcomes?: string[];
  learning_outcomes?: string[];
  sub_parts?: { label: string; text: string; marks?: number }[];
};

type PaperRow = {
  id: string;
  title: string;
  paper_number: string | null;
  year: number | null;
  questions_json: unknown;
};

type SetRow = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  syllabus_doc_id: string | null;
  notes: string | null;
  scoped_disciplines: string[] | null;
};

type AODef = { code: string; title: string | null; description: string | null; weighting_percent: number | null };
type SyllabusTopic = {
  id: string;
  topic_code: string | null;
  title: string;
  outcome_categories: string[];
  learning_outcomes: string[];
  ao_codes: string[];
  section: string | null;
};

type Tab = "ao" | "ko" | "lo" | "papers" | "summary";

type ReviewSnapshot = {
  ran_at: string;
  model: string | null;
  findings?: {
    summary?: string;
    priority_insights?: string[];
    ao_drift?: { ao_code: string; declared_pct?: number; observed_pct?: number; note: string }[];
    unrealised?: { kos: string[]; los: string[]; note?: string };
  };
};

function PaperSetView() {
  const { id } = Route.useParams();
  const [setRow, setSetRow] = useState<SetRow | null>(null);
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [aoDefs, setAoDefs] = useState<AODef[]>([]);
  const [topics, setTopics] = useState<SyllabusTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("ko");
  const [running, setRunning] = useState(false);
  const [latestReview, setLatestReview] = useState<ReviewSnapshot | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: srow } = await supabase
        .from("paper_sets")
        .select("id,title,subject,level,syllabus_doc_id,notes,scoped_disciplines")
        .eq("id", id)
        .single();
      if (!srow) {
        setLoading(false);
        return;
      }
      setSetRow(srow as SetRow);

      const { data: links } = await supabase
        .from("paper_set_papers")
        .select("paper_id,position")
        .eq("set_id", id)
        .order("position");
      const ids = ((links as { paper_id: string }[]) ?? []).map((l) => l.paper_id);
      if (ids.length > 0) {
        const { data: pps } = await supabase
          .from("past_papers")
          .select("id,title,paper_number,year,questions_json")
          .in("id", ids);
        const order = new Map(ids.map((pid, i) => [pid, i] as const));
        const sorted = ((pps as PaperRow[]) ?? []).sort(
          (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
        );
        setPapers(sorted);
      }

      const sd = (srow as SetRow).syllabus_doc_id;
      if (sd) {
        const [{ data: aos }, { data: tps }] = await Promise.all([
          supabase
            .from("syllabus_assessment_objectives")
            .select("code,title,description,weighting_percent")
            .eq("source_doc_id", sd)
            .order("position"),
          supabase
            .from("syllabus_topics")
            .select("id,topic_code,title,outcome_categories,learning_outcomes,ao_codes,section")
            .eq("source_doc_id", sd)
            .order("position"),
        ]);
        setAoDefs((aos as AODef[]) ?? []);
        setTopics((tps as SyllabusTopic[]) ?? []);
      }

      const { data: rev } = await supabase
        .from("paper_set_reviews")
        .select("snapshot,ran_at,model")
        .eq("set_id", id)
        .order("ran_at", { ascending: false })
        .limit(1);
      const r = (rev as { snapshot: ReviewSnapshot; ran_at: string; model: string | null }[] | null)?.[0];
      if (r?.snapshot) setLatestReview({ ...r.snapshot, ran_at: r.ran_at, model: r.model });

      setLoading(false);
    })();
  }, [id]);

  const flatQuestions = useMemo(() => {
    const out: { paperId: string; q: ParsedQuestion; effectiveMarks: number }[] = [];
    for (const p of papers) {
      const arr = Array.isArray(p.questions_json) ? (p.questions_json as ParsedQuestion[]) : [];
      for (const q of arr) {
        const subSum = (q.sub_parts ?? []).reduce((s, sp) => s + (sp.marks ?? 0), 0);
        const m = subSum > 0 ? subSum : (q.marks ?? 0);
        out.push({ paperId: p.id, q, effectiveMarks: m });
      }
    }
    return out;
  }, [papers]);

  const totalMarks = flatQuestions.reduce((s, x) => s + x.effectiveMarks, 0);
  const totalQuestions = flatQuestions.length;

  const { inScope, disciplineUniverse, discLookup } = useMemo(() => {
    const topicLikes = topics.map((t) => ({
      title: t.title,
      section: t.section,
      outcome_categories: t.outcome_categories ?? [],
      learning_outcomes: t.learning_outcomes ?? [],
    }));
    const lookup = buildDisciplineLookup(topicLikes);
    const universe = Array.from(lookup.universe).filter((d) => d !== "General");
    const scope = inferInScopeDisciplines({
      questions: flatQuestions.map((x) => ({
        topic: x.q.topic,
        knowledge_outcomes: x.q.knowledge_outcomes,
        learning_outcomes: x.q.learning_outcomes,
      })),
      topics: topicLikes,
      override: setRow?.scoped_disciplines ?? null,
    });
    return { inScope: scope, disciplineUniverse: universe, discLookup: lookup };
  }, [topics, flatQuestions, setRow?.scoped_disciplines]);

  const updateScope = async (next: string[] | null) => {
    if (setRow) setSetRow({ ...setRow, scoped_disciplines: next });
    await supabase.from("paper_sets").update({ scoped_disciplines: next }).eq("id", id);
  };

  const aoMarkShare = useMemo(() => {
    const aoTotals = new Map<string, number>();
    for (const { q, effectiveMarks } of flatQuestions) {
      const codes = (q.ao_codes ?? []).filter(Boolean);
      if (codes.length === 0) {
        aoTotals.set("Untagged", (aoTotals.get("Untagged") ?? 0) + effectiveMarks);
        continue;
      }
      const per = effectiveMarks / codes.length;
      for (const c of codes) aoTotals.set(c, (aoTotals.get(c) ?? 0) + per);
    }
    return aoTotals;
  }, [flatQuestions]);

  const koCoverage = useMemo(() => {
    type Row = {
      ko: string;
      papers: Map<string, number>;
      total: number;
    };
    const map = new Map<string, Row>();
    for (const t of topics) {
      for (const ko of t.outcome_categories ?? []) {
        const k = ko.trim();
        if (!k) continue;
        if (!map.has(k)) map.set(k, { ko: k, papers: new Map(), total: 0 });
      }
    }
    for (const { paperId, q } of flatQuestions) {
      const kos = new Set((q.knowledge_outcomes ?? []).map((s) => s.trim()).filter(Boolean));
      for (const ko of kos) {
        const row = map.get(ko) ?? { ko, papers: new Map(), total: 0 };
        row.papers.set(paperId, (row.papers.get(paperId) ?? 0) + 1);
        row.total += 1;
        map.set(ko, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ko.localeCompare(b.ko));
  }, [flatQuestions, topics]);

  const loCoverage = useMemo(() => {
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,!?\s]+$/g, "").trim();
    type Row = { lo: string; papers: Map<string, number>; total: number };
    const map = new Map<string, Row>();
    for (const t of topics) {
      for (const lo of t.learning_outcomes ?? []) {
        const k = norm(lo);
        if (!k) continue;
        if (!map.has(k)) map.set(k, { lo, papers: new Map(), total: 0 });
      }
    }
    for (const { paperId, q } of flatQuestions) {
      const los = new Set((q.learning_outcomes ?? []).map((s) => s.trim()).filter(Boolean));
      for (const lo of los) {
        const k = norm(lo);
        const row = map.get(k) ?? { lo, papers: new Map(), total: 0 };
        row.papers.set(paperId, (row.papers.get(paperId) ?? 0) + 1);
        row.total += 1;
        map.set(k, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.lo.localeCompare(b.lo));
  }, [flatQuestions, topics]);

  const perPaper = useMemo(() => {
    return papers.map((p) => {
      const qs = flatQuestions.filter((x) => x.paperId === p.id);
      const marks = qs.reduce((s, x) => s + x.effectiveMarks, 0);
      const aoMap = new Map<string, number>();
      for (const x of qs) {
        const codes = (x.q.ao_codes ?? []).filter(Boolean);
        if (codes.length === 0) continue;
        const per = x.effectiveMarks / codes.length;
        for (const c of codes) aoMap.set(c, (aoMap.get(c) ?? 0) + per);
      }
      const kosTouched = new Set(
        qs.flatMap((x) => (x.q.knowledge_outcomes ?? []).filter(Boolean)),
      );
      return { paper: p, marks, questions: qs.length, aoMap, koCount: kosTouched.size };
    });
  }, [papers, flatQuestions]);

  const runReview = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("paper-set-review", {
        body: { set_id: id },
      });
      if (error) throw error;
      const snap = data as ReviewSnapshot;
      setLatestReview(snap);
      setTab("summary");
      toast.success("Macro review complete");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Review failed";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-5xl px-4 py-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!setRow) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-5xl px-4 py-12 text-sm text-muted-foreground">
          Paper set not found. <Link to="/dashboard" className="text-primary underline">Back to dashboard</Link>
        </main>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "ko", label: "By KO" },
    { key: "lo", label: "By LO" },
    { key: "ao", label: "AO balance" },
    { key: "papers", label: "Per-paper" },
    { key: "summary", label: "Macro summary" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All assessments
        </Link>

        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-semibold">{setRow.title}</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {setRow.subject} · {setRow.level} · {papers.length} papers · {totalQuestions} questions · {totalMarks} marks
            </p>
            {setRow.notes ? <p className="mt-1 text-xs text-muted-foreground italic">{setRow.notes}</p> : null}
          </div>
          <Button onClick={runReview} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {latestReview ? "Re-run macro review" : "Run macro review"}
          </Button>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "ko" ? (
          <CoverageList
            rows={koCoverage.map((r) => ({ name: r.ko, total: r.total, papers: r.papers }))}
            papers={papers}
            emptyHint="No KO tags found across these papers."
          />
        ) : tab === "lo" ? (
          <CoverageList
            rows={loCoverage.map((r) => ({ name: r.lo, total: r.total, papers: r.papers }))}
            papers={papers}
            emptyHint="No LO tags found across these papers."
          />
        ) : tab === "ao" ? (
          <AOPanel aoDefs={aoDefs} aoMarkShare={aoMarkShare} totalMarks={totalMarks} />
        ) : tab === "papers" ? (
          <PerPaperPanel rows={perPaper} aoDefs={aoDefs} />
        ) : (
          <MacroSummaryPanel review={latestReview} running={running} />
        )}
      </main>
    </div>
  );
}

function CoverageList({
  rows,
  papers,
  emptyHint,
}: {
  rows: { name: string; total: number; papers: Map<string, number> }[];
  papers: PaperRow[];
  emptyHint: string;
}) {
  const covered = rows.filter((r) => r.total > 0);
  const uncovered = rows.filter((r) => r.total === 0);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint}</p>;
  }
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2 border-b border-border text-xs text-muted-foreground">
          <span>{covered.length} of {rows.length} covered</span>
          <span>Per-paper coverage</span>
        </div>
        <ul className="divide-y divide-border">
          {covered.map((r) => (
            <li key={r.name} className="px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.total} question{r.total === 1 ? "" : "s"} across the set</div>
              </div>
              <div className="flex flex-wrap gap-1 justify-end">
                {papers.map((p, i) => {
                  const c = r.papers.get(p.id) ?? 0;
                  return (
                    <Badge
                      key={p.id}
                      variant={c > 0 ? "default" : "outline"}
                      title={p.title}
                    >
                      P{i + 1}{c > 0 ? ` ·${c}` : ""}
                    </Badge>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {uncovered.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            Unrealised — {uncovered.length} not exercised by any paper in this set
          </h3>
          <ul className="mt-2 space-y-1 text-sm">
            {uncovered.map((r) => (
              <li key={r.name} className="text-muted-foreground">{r.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AOPanel({ aoDefs, aoMarkShare, totalMarks }: { aoDefs: AODef[]; aoMarkShare: Map<string, number>; totalMarks: number }) {
  if (totalMarks === 0) {
    return <p className="text-sm text-muted-foreground">No marks tagged yet — papers may need re-parsing.</p>;
  }
  const codes = Array.from(new Set([...aoDefs.map((a) => a.code), ...Array.from(aoMarkShare.keys())])).sort();
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        AO mark-share aggregated across the set, compared with the syllabus weighting where one is declared.
      </p>
      <div className="space-y-2">
        {codes.map((code) => {
          const def = aoDefs.find((a) => a.code === code);
          const marks = aoMarkShare.get(code) ?? 0;
          const observed = totalMarks > 0 ? (marks / totalMarks) * 100 : 0;
          const declared = def?.weighting_percent ?? null;
          const delta = declared != null ? observed - declared : null;
          const danger = delta != null && Math.abs(delta) > 8;
          return (
            <div key={code} className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <div className="font-mono">{code}</div>
              <div className="relative h-3 rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.min(100, observed)}%` }}
                />
                {declared != null ? (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-foreground/60"
                    style={{ left: `${Math.min(100, declared)}%` }}
                    title={`Declared ${declared}%`}
                  />
                ) : null}
              </div>
              <div className="tabular-nums text-right">
                {observed.toFixed(0)}%
                {declared != null ? (
                  <span className={`ml-2 text-xs ${danger ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                    vs {declared}% ({delta && delta > 0 ? "+" : ""}{delta?.toFixed(0)}pp)
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {codes.includes("Untagged") ? (
        <p className="text-xs text-muted-foreground">
          "Untagged" marks come from questions whose AO codes weren't classified during parsing.
        </p>
      ) : null}
    </div>
  );
}

function PerPaperPanel({ rows, aoDefs }: { rows: { paper: PaperRow; marks: number; questions: number; aoMap: Map<string, number>; koCount: number }[]; aoDefs: AODef[] }) {
  const aoCodes = aoDefs.map((a) => a.code);
  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2">Paper</th>
            <th className="px-3 py-2 text-right">Q</th>
            <th className="px-3 py-2 text-right">Marks</th>
            <th className="px-3 py-2 text-right">KOs</th>
            {aoCodes.map((c) => <th key={c} className="px-3 py-2 text-right font-mono">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.paper.id} className="border-t border-border">
              <td className="px-3 py-2">
                <div className="font-medium">P{i + 1} · {r.paper.title}</div>
                <div className="text-xs text-muted-foreground">
                  {[r.paper.year, r.paper.paper_number ? `Paper ${r.paper.paper_number}` : null].filter(Boolean).join(" · ")}
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.questions}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.marks}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.koCount}</td>
              {aoCodes.map((c) => {
                const m = r.aoMap.get(c) ?? 0;
                const pct = r.marks > 0 ? (m / r.marks) * 100 : 0;
                return (
                  <td key={c} className="px-3 py-2 text-right tabular-nums">
                    {m > 0 ? `${pct.toFixed(0)}%` : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MacroSummaryPanel({ review, running }: { review: ReviewSnapshot | null; running: boolean }) {
  if (running) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Running macro review across the set…
      </div>
    );
  }
  if (!review) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        Run the macro review to get a calm 2–4 line summary of the demand balance and any structural gaps across the set.
      </div>
    );
  }
  const f = review.findings ?? {};
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {f.summary ? <p className="text-sm">{f.summary}</p> : null}
        {(f.priority_insights ?? []).length > 0 ? (
          <ul className="space-y-1 text-sm">
            {(f.priority_insights ?? []).map((s, i) => (
              <li key={i} className="flex gap-2"><span className="text-primary">›</span><span>{s}</span></li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          Run at {new Date(review.ran_at).toLocaleString()}{review.model ? ` · ${review.model}` : ""}
        </p>
      </div>
      {(f.ao_drift ?? []).length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">AO drift</h3>
          <ul className="space-y-1 text-sm">
            {(f.ao_drift ?? []).map((d, i) => (
              <li key={i}>
                <span className="font-mono">{d.ao_code}</span> — {d.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {f.unrealised && (f.unrealised.kos.length + f.unrealised.los.length > 0) ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">Unrealised outcomes</h3>
          {f.unrealised.note ? <p className="text-sm text-muted-foreground mb-2">{f.unrealised.note}</p> : null}
          {f.unrealised.kos.length > 0 ? (
            <p className="text-sm"><span className="text-muted-foreground">KOs:</span> {f.unrealised.kos.join(" · ")}</p>
          ) : null}
          {f.unrealised.los.length > 0 ? (
            <p className="text-sm"><span className="text-muted-foreground">LOs:</span> {f.unrealised.los.join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
