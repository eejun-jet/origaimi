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
  strand: string | null;
  sub_strand: string | null;
  learning_outcome_code: string | null;
};

type Tab = "ao" | "coverage" | "papers" | "summary";

type ReviewSnapshot = {
  ran_at: string;
  model: string | null;
  papers_used?: number;
  papers_skipped?: number;
  total_questions?: number;
  total_marks?: number;
  unclassified_questions?: number;
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
  const [tab, setTab] = useState<Tab>("coverage");
  const [explorerKO, setExplorerKO] = useState<string | null>(null);
  const [coverageFilter, setCoverageFilter] = useState<"all" | "covered" | "under" | "untested">("all");
  const [running, setRunning] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
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
            .select("id,topic_code,title,outcome_categories,learning_outcomes,ao_codes,section,strand,sub_strand,learning_outcome_code")
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

  // ─── KO (strand) → sub_strand → LO drill-down ────────────────────────────
  // Mirrors the Assessment Coach (assessment.$id.tsx :: koLoGroups) so the
  // visual story stays consistent: strand is the KO container, sub_strand is
  // the content bucket, learning_outcomes are the LO leaves.
  const koGroups = useMemo(() => {
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,!?\s]+$/g, "").trim();

    type LoEntry = {
      code: string | null;
      text: string;
      covered: boolean;
      questionCount: number;
      papers: Map<string, number>;
    };
    type ContentBucket = { name: string; los: LoEntry[] };
    type KoBucket = {
      name: string;
      discipline: string;
      contents: ContentBucket[];
      flat: LoEntry[];
      coveredLOs: number;
      totalLOs: number;
      questionsTouching: number;
    };

    // Index of LO tags actually used by questions, normalised.
    const loHits = new Map<string, { papers: Map<string, number>; total: number }>();
    for (const { paperId, q } of flatQuestions) {
      const tagged = new Set((q.learning_outcomes ?? []).map((s) => s.trim()).filter(Boolean));
      for (const lo of tagged) {
        const key = norm(lo);
        if (!key) continue;
        const row = loHits.get(key) ?? { papers: new Map(), total: 0 };
        row.papers.set(paperId, (row.papers.get(paperId) ?? 0) + 1);
        row.total += 1;
        loHits.set(key, row);
      }
    }

    const ko = new Map<string, Map<string, Map<string, LoEntry>>>();
    const koDiscipline = new Map<string, string>();
    const ensureKo = (name: string) => {
      if (!ko.has(name)) ko.set(name, new Map());
      return ko.get(name)!;
    };
    const ensureContent = (k: string, c: string) => {
      const m = ensureKo(k);
      if (!m.has(c)) m.set(c, new Map());
      return m.get(c)!;
    };

    for (const t of topics) {
      const los = t.learning_outcomes ?? [];
      if (los.length === 0) continue;
      const koName = (t.strand?.trim() || t.title || "Other").trim();
      const contentName = (t.sub_strand?.trim() || t.title || "").trim() || koName;
      const codeStem = t.learning_outcome_code?.trim() ?? null;
      const bucket = ensureContent(koName, contentName);
      if (!koDiscipline.has(koName)) {
        koDiscipline.set(koName, normaliseDiscipline(t.section));
      }
      los.forEach((loText, i) => {
        if (!loText) return;
        const key = norm(loText);
        if (!key || bucket.has(key)) return;
        const code = codeStem
          ? (los.length === 1 ? codeStem : `${codeStem}.${i + 1}`)
          : null;
        const hit = loHits.get(key);
        bucket.set(key, {
          code,
          text: loText,
          covered: !!hit && hit.total > 0,
          questionCount: hit?.total ?? 0,
          papers: hit?.papers ?? new Map(),
        });
      });
    }

    const buckets: KoBucket[] = [];
    for (const [name, contentMap] of ko.entries()) {
      const contents: ContentBucket[] = [];
      const flat: LoEntry[] = [];
      for (const [cname, loMap] of contentMap.entries()) {
        const items = Array.from(loMap.values()).sort((a, b) => {
          if (a.code && b.code) return a.code.localeCompare(b.code, undefined, { numeric: true });
          return a.text.localeCompare(b.text);
        });
        contents.push({ name: cname, los: items });
        for (const it of items) flat.push(it);
      }
      contents.sort((a, b) => a.name.localeCompare(b.name));
      const covered = flat.filter((l) => l.covered).length;
      const questionsTouching = flat.reduce((s, l) => s + l.questionCount, 0);
      buckets.push({
        name,
        discipline: koDiscipline.get(name) ?? "General",
        contents,
        flat,
        coveredLOs: covered,
        totalLOs: flat.length,
        questionsTouching,
      });
    }

    const filtered = inScope ? buckets.filter((b) => inScope.has(b.discipline)) : buckets;
    return filtered.sort((a, b) => {
      if (a.discipline !== b.discipline) return a.discipline.localeCompare(b.discipline);
      return a.name.localeCompare(b.name);
    });
  }, [topics, flatQuestions, inScope]);

  const totalLOsInScope = koGroups.reduce((s, g) => s + g.totalLOs, 0);
  const coveredLOsInScope = koGroups.reduce((s, g) => s + g.coveredLOs, 0);

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

  const untaggedCount = useMemo(
    () => flatQuestions.filter((x) => !((x.q.ao_codes ?? []).length > 0 || (x.q.learning_outcomes ?? []).length > 0 || (x.q.knowledge_outcomes ?? []).length > 0)).length,
    [flatQuestions],
  );

  const untaggedByPaper = useMemo(() => {
    return papers
      .map((p) => {
        const qs = flatQuestions.filter((x) => x.paperId === p.id);
        const untagged = qs.filter((x) => !((x.q.ao_codes ?? []).length > 0 || (x.q.learning_outcomes ?? []).length > 0 || (x.q.knowledge_outcomes ?? []).length > 0)).length;
        return { paper: p, total: qs.length, untagged };
      })
      .filter((r) => r.untagged > 0);
  }, [papers, flatQuestions]);

  const reloadPapers = async () => {
    const { data: links } = await supabase
      .from("paper_set_papers").select("paper_id,position").eq("set_id", id).order("position");
    const ids = ((links as { paper_id: string }[]) ?? []).map((l) => l.paper_id);
    if (ids.length === 0) return;
    const { data: pps } = await supabase
      .from("past_papers").select("id,title,paper_number,year,questions_json").in("id", ids);
    const order = new Map(ids.map((pid, i) => [pid, i] as const));
    const sorted = ((pps as PaperRow[]) ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    setPapers(sorted);
  };

  const reclassifyOne = async (paperId: string, paperTitle: string) => {
    setReclassifying(true);
    try {
      toast.message(`Reclassifying ${paperTitle}…`);
      const { data, error } = await supabase.functions.invoke("reclassify-paper", { body: { paper_id: paperId } });
      if (error) {
        toast.error(`Failed: ${paperTitle}`, { description: error.message });
        return;
      }
      const r = data as { classified?: number; total?: number };
      toast.success(`Tagged ${r?.classified ?? 0}/${r?.total ?? 0} questions in ${paperTitle}`);
      await reloadPapers();
    } finally {
      setReclassifying(false);
    }
  };

  const reclassifyAll = async () => {
    if (papers.length === 0) return;
    setReclassifying(true);
    let okCount = 0;
    let totalClassified = 0;
    let totalQs = 0;
    try {
      for (let i = 0; i < papers.length; i++) {
        const p = papers[i];
        toast.message(`Reclassifying paper ${i + 1} of ${papers.length}…`, { description: p.title });
        const { data, error } = await supabase.functions.invoke("reclassify-paper", { body: { paper_id: p.id } });
        if (error) {
          toast.error(`Failed: ${p.title}`, { description: error.message });
          continue;
        }
        const r = data as { classified?: number; total?: number };
        okCount++;
        totalClassified += r?.classified ?? 0;
        totalQs += r?.total ?? 0;
      }
      toast.success(`Tagged ${totalClassified}/${totalQs} questions across ${okCount} paper(s)`);
      await reloadPapers();
    } finally {
      setReclassifying(false);
    }
  };

  const runReview = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("paper-set-review", {
        body: { set_id: id },
      });
      // Functions client returns 4xx as a non-throwing error; inspect both.
      const body = data as (ReviewSnapshot & { error?: string; needs_reclassify?: boolean }) | null;
      if (body?.needs_reclassify || body?.error) {
        toast.error(body?.error ?? "Review failed", {
          action: body?.needs_reclassify
            ? { label: "Reclassify now", onClick: () => { void reclassifyAll(); } }
            : undefined,
        });
        return;
      }
      if (error) throw error;
      setLatestReview(body as ReviewSnapshot);
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
    { key: "ao", label: "AO overview" },
    { key: "coverage", label: "KO / LO coverage" },
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
          <div className="flex gap-2">
            <Button variant="outline" onClick={reclassifyAll} disabled={reclassifying || running}>
              {reclassifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reclassify all papers
            </Button>
            <Button onClick={runReview} disabled={running || reclassifying}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {latestReview ? "Re-run macro review" : "Run macro review"}
            </Button>
          </div>
        </header>

        {untaggedCount > 0 && totalQuestions > 0 ? (
          <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm space-y-2">
            <div className="font-medium text-amber-900 dark:text-amber-100">
              {untaggedCount} of {totalQuestions} questions ({Math.round((untaggedCount / totalQuestions) * 100)}%) have no syllabus tags yet.
            </div>
            <p className="text-amber-800/80 dark:text-amber-200/80">
              This is a tagging gap, not a syllabus gap. The macro review needs AO/KO/LO tags on each question to map demand. Reclassify the affected papers below.
            </p>
            {untaggedByPaper.length > 0 ? (
              <ul className="space-y-1.5 pt-1">
                {untaggedByPaper.map((r) => (
                  <li key={r.paper.id} className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-amber-900 dark:text-amber-100">
                      <span className="font-medium">{r.paper.title}</span>{" "}
                      <span className="text-amber-800/70 dark:text-amber-200/70">— {r.untagged}/{r.total} untagged</span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reclassifyOne(r.paper.id, r.paper.title)}
                      disabled={reclassifying || running}
                    >
                      Reclassify this paper
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {disciplineUniverse.length >= 2 && (
          <PaperSetScopeStrip
            universe={disciplineUniverse}
            inScope={inScope}
            override={setRow.scoped_disciplines ?? null}
            onChange={updateScope}
          />
        )}

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

        {tab === "coverage" ? (
          <CoverageExplorer
            groups={koGroups}
            papers={papers}
            coveredLOs={coveredLOsInScope}
            totalLOs={totalLOsInScope}
            selectedKO={explorerKO}
            onSelectKO={setExplorerKO}
            filter={coverageFilter}
            onFilterChange={setCoverageFilter}
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

type LoEntry = {
  code: string | null;
  text: string;
  covered: boolean;
  questionCount: number;
  papers: Map<string, number>;
};
type ContentBucket = { name: string; los: LoEntry[] };
type KoBucket = {
  name: string;
  discipline: string;
  contents: ContentBucket[];
  flat: LoEntry[];
  coveredLOs: number;
  totalLOs: number;
  questionsTouching: number;
};

function CoverageExplorer({
  groups,
  papers,
  coveredLOs,
  totalLOs,
  selectedKO,
  onSelectKO,
  filter,
  onFilterChange,
}: {
  groups: KoBucket[];
  papers: PaperRow[];
  coveredLOs: number;
  totalLOs: number;
  selectedKO: string | null;
  onSelectKO: (k: string | null) => void;
  filter: "all" | "covered" | "under" | "untested";
  onFilterChange: (f: "all" | "covered" | "under" | "untested") => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No syllabus topics in scope — load or attach a syllabus to see KO/LO coverage.
      </p>
    );
  }

  const selected = selectedKO ? groups.find((g) => g.name === selectedKO) ?? null : null;
  if (selected) {
    return <KoDetail group={selected} papers={papers} onBack={() => onSelectKO(null)} />;
  }

  const classify = (g: KoBucket): "covered" | "under" | "untested" => {
    if (g.totalLOs === 0) return "untested";
    const pct = g.coveredLOs / g.totalLOs;
    if (pct === 0) return "untested";
    if (pct < 0.34) return "under";
    return "covered";
  };

  const filtered = groups.filter((g) => filter === "all" || classify(g) === filter);
  const counts = {
    all: groups.length,
    covered: groups.filter((g) => classify(g) === "covered").length,
    under: groups.filter((g) => classify(g) === "under").length,
    untested: groups.filter((g) => classify(g) === "untested").length,
  };

  const filterChips: { key: typeof filter; label: string }[] = [
    { key: "all", label: `All ${counts.all}` },
    { key: "covered", label: `Covered ${counts.covered}` },
    { key: "under", label: `Under-tested ${counts.under}` },
    { key: "untested", label: `Untested ${counts.untested}` },
  ];

  // Group by discipline for visual sectioning, like the assessment coach.
  const byDiscipline = new Map<string, KoBucket[]>();
  for (const g of filtered) {
    const arr = byDiscipline.get(g.discipline) ?? [];
    arr.push(g);
    byDiscipline.set(g.discipline, arr);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span
            className="font-medium"
            title="Coverage = how many syllabus learning outcomes are touched by at least one question. Real exams typically test 20–30% of the full syllabus, so partial coverage is normal."
          >
            {coveredLOs} of {totalLOs} learning outcomes assessed
          </span>
          <span className="ml-2 text-muted-foreground">
            ({totalLOs > 0 ? Math.round((coveredLOs / totalLOs) * 100) : 0}%)
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filterChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onFilterChange(c.key)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                filter === c.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {Array.from(byDiscipline.entries()).map(([disc, items]) => (
        <section key={disc} className="space-y-2">
          {byDiscipline.size > 1 ? (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{disc}</h3>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((g) => {
              const pct = g.totalLOs > 0 ? (g.coveredLOs / g.totalLOs) * 100 : 0;
              const status = classify(g);
              const tone =
                status === "covered" ? "border-emerald-500/40 bg-emerald-500/5" :
                status === "under" ? "border-amber-500/40 bg-amber-500/5" :
                "border-border bg-muted/30";
              return (
                <button
                  key={g.name}
                  type="button"
                  onClick={() => onSelectKO(g.name)}
                  onDoubleClick={() => onSelectKO(g.name)}
                  className={`text-left rounded-lg border p-3 transition hover:border-primary/60 hover:bg-card ${tone}`}
                  title="Click to drill into LO coverage"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium leading-tight">{g.name}</div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{g.discipline}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {g.coveredLOs} / {g.totalLOs} LOs · {g.questionsTouching} question{g.questionsTouching === 1 ? "" : "s"}
                  </div>
                  <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full ${status === "covered" ? "bg-emerald-500" : status === "under" ? "bg-amber-500" : "bg-muted-foreground/30"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {papers.map((p, i) => {
                      const hits = g.flat.reduce((s, l) => s + (l.papers.get(p.id) ?? 0), 0);
                      return (
                        <Badge
                          key={p.id}
                          variant={hits > 0 ? "default" : "outline"}
                          className="text-[10px]"
                          title={`${p.title}${hits > 0 ? ` — ${hits} question(s)` : " — no questions touch this KO"}`}
                        >
                          P{i + 1}{hits > 0 ? ` ·${hits}` : ""}
                        </Badge>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function KoDetail({ group, papers, onBack }: { group: KoBucket; papers: PaperRow[]; onBack: () => void }) {
  const pct = group.totalLOs > 0 ? Math.round((group.coveredLOs / group.totalLOs) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to KO grid
          </button>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">{group.name}</h2>
            <Badge variant="outline" className="text-[10px]">{group.discipline}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {group.coveredLOs} of {group.totalLOs} LOs covered ({pct}%) · {group.questionsTouching} question{group.questionsTouching === 1 ? "" : "s"} across the set
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {group.contents.map((c) => (
          <div key={c.name} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-muted/30 text-sm font-medium">
              {c.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {c.los.filter((l) => l.covered).length} / {c.los.length} covered
              </span>
            </div>
            <ul className="divide-y divide-border">
              {c.los.map((lo) => (
                <li key={lo.text} className="px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">
                      {lo.code ? <span className="font-mono text-xs text-muted-foreground mr-2">{lo.code}</span> : null}
                      {lo.text}
                    </div>
                    {lo.covered ? (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {lo.questionCount} question{lo.questionCount === 1 ? "" : "s"}
                      </div>
                    ) : (
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Not assessed by this set</div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {papers.map((p, i) => {
                      const c2 = lo.papers.get(p.id) ?? 0;
                      return (
                        <Badge key={p.id} variant={c2 > 0 ? "default" : "outline"} className="text-[10px]" title={p.title}>
                          P{i + 1}{c2 > 0 ? ` ·${c2}` : ""}
                        </Badge>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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
  const coverageBits: string[] = [];
  if (typeof review.papers_used === "number") coverageBits.push(`${review.papers_used} question paper${review.papers_used === 1 ? "" : "s"}`);
  if (typeof review.total_questions === "number") coverageBits.push(`${review.total_questions} questions`);
  if (typeof review.total_marks === "number") coverageBits.push(`${review.total_marks} marks`);
  const skipNote = review.papers_skipped && review.papers_skipped > 0
    ? ` (skipped ${review.papers_skipped} mark scheme${review.papers_skipped === 1 ? "" : "s"})`
    : "";
  const unclassifiedRatio = review.total_questions && review.total_questions > 0
    ? (review.unclassified_questions ?? 0) / review.total_questions
    : 0;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {coverageBits.length > 0 ? (
          <p className="text-xs text-muted-foreground">Reviewed {coverageBits.join(" · ")}{skipNote}.</p>
        ) : null}
        {unclassifiedRatio >= 0.5 ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            {review.unclassified_questions} of {review.total_questions} questions have no AO/LO tags yet — re-parse the affected papers so the review can map coverage properly.
          </div>
        ) : null}
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

function PaperSetScopeStrip({
  universe,
  inScope,
  override,
  onChange,
}: {
  universe: string[];
  inScope: Set<string> | null;
  override: string[] | null;
  onChange: (next: string[] | null) => void | Promise<void>;
}) {
  const isAuto = !override || override.length === 0;
  const active = (d: string) => (inScope ? inScope.has(d) : true);
  const toggle = (d: string) => {
    const current = new Set(universe.filter(active));
    if (current.has(d)) current.delete(d);
    else current.add(d);
    if (current.size === 0) return;
    onChange(Array.from(current));
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">Scope:</span>
        {universe.map((d) => {
          const on = active(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggle(d)}
              className={`rounded-full border px-2 py-0.5 transition ${
                on
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"
              }`}
              title={on ? `${d} is in scope — click to exclude` : `${d} excluded — click to include`}
            >
              {on ? "✓ " : ""}{d}
            </button>
          );
        })}
        <span className="ml-auto text-muted-foreground">
          {isAuto ? "Auto-detected from question tags" : "Manual override"}
        </span>
        {!isAuto && (
          <button type="button" onClick={() => onChange(null)} className="text-primary hover:underline">
            Reset to auto
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Untested disciplines are hidden from KO / LO coverage and "Untested" flags.
      </p>
    </div>
  );
}
