import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Sparkles, RefreshCw, Check, X, Wand2, Users, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/authentic/$id")({
  component: AuthenticPlanPage,
  head: () => ({ meta: [{ title: "Authentic plan · origAImi" }] }),
});

type Plan = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  unit_focus: string | null;
  duration_weeks: number | null;
  class_size: number | null;
  status: string;
  goals: string | null;
  constraints: string | null;
  syllabus_doc_id: string | null;
  notes: string | null;
};

type SyllabusDoc = { id: string; title: string; subject: string | null; level: string | null; syllabus_code: string | null };
type SyllabusTopic = { id: string; strand: string | null; sub_strand: string | null; title: string; learning_outcomes: string[] | null };

type RubricLevel = { label: string; descriptor: string };
type RubricCriterion = { criterion: string; levels: RubricLevel[] };
type Idea = {
  id: string;
  plan_id: string;
  position: number;
  mode: string;
  title: string;
  brief: string | null;
  student_brief: string | null;
  duration_minutes: number | null;
  group_size: string | null;
  ao_codes: string[];
  knowledge_outcomes: string[];
  learning_outcomes: string[];
  materials: string[];
  rubric: RubricCriterion[];
  milestones: { label: string; when: string }[];
  teacher_notes: string | null;
  status: "suggested" | "saved" | "rejected" | string;
};

const MODE_LABEL: Record<string, string> = {
  mini_test: "Mini-test",
  performance_task: "Performance task",
  project: "Project",
  oral: "Oral / presentation",
  written_authentic: "Written authentic",
  self_peer: "Self / peer",
};

const MODE_COLOR: Record<string, string> = {
  mini_test: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  performance_task: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  project: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  oral: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  written_authentic: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  self_peer: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

function AuthenticPlanPage() {
  const { id } = Route.useParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [openIdeaId, setOpenIdeaId] = useState<string | null>(null);
  const [topics, setTopics] = useState<SyllabusTopic[]>([]);
  const [docs, setDocs] = useState<SyllabusDoc[]>([]);

  const load = async () => {
    const [{ data: p }, { data: i }] = await Promise.all([
      supabase.from("authentic_plans").select("*").eq("id", id).single(),
      supabase.from("authentic_ideas").select("*").eq("plan_id", id).order("position"),
    ]);
    setPlan((p as unknown as Plan) ?? null);
    setIdeas(((i as unknown) as Idea[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  // Load syllabus topics for the picker
  useEffect(() => {
    const docId = plan?.syllabus_doc_id;
    if (!docId) { setTopics([]); return; }
    (async () => {
      const { data } = await supabase
        .from("syllabus_topics")
        .select("id,strand,sub_strand,title,learning_outcomes")
        .eq("source_doc_id", docId)
        .order("position")
        .limit(300);
      setTopics(((data as unknown) as SyllabusTopic[]) ?? []);
    })();
  }, [plan?.syllabus_doc_id]);

  // Load syllabus docs list (for picker when none set)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("syllabus_documents")
        .select("id,title,subject,level,syllabus_code")
        .order("title");
      setDocs(((data as unknown) as SyllabusDoc[]) ?? []);
    })();
  }, []);

  // Auto-generate when the plan is freshly created.
  useEffect(() => {
    if (!plan) return;
    if (plan.status === "generating" && ideas.length === 0 && !generating) {
      runGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.status]);

  const runGenerate = async () => {
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke("generate-authentic-ideas", { body: { plan_id: id } });
      if (error) throw error;
      await load();
      toast.success("Ideas generated.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const setStatus = async (idea: Idea, status: Idea["status"]) => {
    const { error } = await supabase.from("authentic_ideas").update({ status }).eq("id", idea.id);
    if (error) { toast.error(error.message); return; }
    setIdeas((prev) => prev.map((x) => x.id === idea.id ? { ...x, status } : x));
  };

  const filteredIdeas = useMemo(() => ideas.filter((i) => {
    if (savedOnly && i.status !== "saved") return false;
    if (filter !== "all" && i.mode !== filter) return false;
    if (i.status === "rejected") return false;
    return true;
  }), [ideas, filter, savedOnly]);

  const modeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of ideas) if (i.status !== "rejected") m[i.mode] = (m[i.mode] ?? 0) + 1;
    return m;
  }, [ideas]);

  const openIdea = ideas.find((i) => i.id === openIdeaId) ?? null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
        </main>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p className="text-sm text-muted-foreground">Plan not found.</p>
          <Link to="/dashboard" className="mt-2 inline-block text-sm text-primary underline">Back to dashboard</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-paper text-2xl font-semibold tracking-tight">{plan.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.subject ?? "—"} · {plan.level ?? "—"} · {plan.duration_weeks ?? "?"} weeks · class of {plan.class_size ?? "?"}
            </p>
            {plan.unit_focus ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{plan.unit_focus}</p> : null}
          </div>
          <Button onClick={runGenerate} disabled={generating} variant="outline" className="gap-2">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Regenerate suggestions
          </Button>
        </div>

        {plan.status === "failed" && plan.notes ? (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <div className="font-medium text-destructive">Generation failed</div>
            <p className="mt-1 text-xs text-muted-foreground">{plan.notes}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={runGenerate} disabled={generating}>Retry</Button>
          </div>
        ) : null}

        {!plan.syllabus_doc_id ? (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <div className="font-medium">Pick a syllabus to enable KO/LO alignment</div>
            <p className="mt-1 text-xs text-muted-foreground">Teachers can then tag each idea with the actual KOs and LOs.</p>
            <select
              className="mt-2 rounded-md border border-border bg-background px-2 py-1 text-xs"
              defaultValue=""
              onChange={async (e) => {
                const v = e.target.value;
                if (!v) return;
                await supabase.from("authentic_plans").update({ syllabus_doc_id: v }).eq("id", id);
                load();
              }}
            >
              <option value="">— choose syllabus —</option>
              {docs
                .filter((d) => (!plan.subject || d.subject === plan.subject) && (!plan.level || d.level === plan.level))
                .map((d) => (
                  <option key={d.id} value={d.id}>{`${d.syllabus_code ?? ""} ${d.title}`.trim()}</option>
                ))}
            </select>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All ({ideas.filter((i) => i.status !== "rejected").length})</FilterChip>
          {Object.keys(MODE_LABEL).map((m) => (
            <FilterChip key={m} active={filter === m} onClick={() => setFilter(m)}>
              {MODE_LABEL[m]} ({modeCounts[m] ?? 0})
            </FilterChip>
          ))}
          <span className="mx-2 h-6 w-px bg-border" />
          <FilterChip active={savedOnly} onClick={() => setSavedOnly((s) => !s)}>Saved only</FilterChip>
        </div>

        <div className="mt-6">
          {generating && ideas.length === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-48 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          ) : filteredIdeas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">No ideas yet. Hit Regenerate.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredIdeas.map((i) => (
                <IdeaTile key={i.id} idea={i} onOpen={() => setOpenIdeaId(i.id)} onSave={() => setStatus(i, i.status === "saved" ? "suggested" : "saved")} onReject={() => setStatus(i, "rejected")} />
              ))}
            </div>
          )}
        </div>
      </main>

      <Sheet open={!!openIdea} onOpenChange={(o) => !o && setOpenIdeaId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {openIdea ? <IdeaDetail idea={openIdea} topics={topics} onChanged={load} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"}`}>
      {children}
    </button>
  );
}

function IdeaTile({ idea, onOpen, onSave, onReject }: { idea: Idea; onOpen: () => void; onSave: () => void; onReject: () => void }) {
  return (
    <div className={`group flex flex-col rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm ${idea.status === "saved" ? "border-primary/60" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MODE_COLOR[idea.mode] ?? "bg-muted text-muted-foreground"}`}>
          {MODE_LABEL[idea.mode] ?? idea.mode}
        </span>
        {idea.status === "saved" ? <Badge className="bg-success/15 text-success">Saved</Badge> : null}
      </div>
      <button type="button" onClick={onOpen} className="mt-3 text-left">
        <h3 className="line-clamp-2 font-medium group-hover:text-primary">{idea.title}</h3>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{idea.brief}</p>
      </button>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {idea.duration_minutes ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{idea.duration_minutes} min</span> : null}
        {idea.group_size ? <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{idea.group_size}</span> : null}
      </div>
      {idea.ao_codes.length || idea.knowledge_outcomes.length || idea.learning_outcomes.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {idea.ao_codes.map((a) => <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>)}
          {idea.knowledge_outcomes.length ? <Badge variant="outline" className="text-[10px]">{idea.knowledge_outcomes.length} KO</Badge> : null}
          {idea.learning_outcomes.length ? <Badge variant="outline" className="text-[10px]">{idea.learning_outcomes.length} LO</Badge> : null}
        </div>
      ) : null}
      <div className="mt-4 flex justify-between gap-2 border-t border-border pt-3">
        <Button size="sm" variant="ghost" onClick={onReject} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="outline" onClick={onOpen}>Details</Button>
        <Button size="sm" onClick={onSave} className="gap-1">
          <Check className="h-3.5 w-3.5" /> {idea.status === "saved" ? "Unsave" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function IdeaDetail({ idea, topics, onChanged }: { idea: Idea; topics: SyllabusTopic[]; onChanged: () => void | Promise<void> }) {
  const [instruction, setInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [selectedKOs, setSelectedKOs] = useState<string[]>(idea.knowledge_outcomes ?? []);
  const [selectedLOs, setSelectedLOs] = useState<string[]>(idea.learning_outcomes ?? []);
  const [savingAlign, setSavingAlign] = useState(false);

  // Build KO list (unique strands/titles) and LO list (filtered by selected KOs).
  const koOptions = useMemo(() => {
    const set = new Map<string, SyllabusTopic[]>();
    for (const t of topics) {
      const key = (t.strand ?? t.title ?? "").trim();
      if (!key) continue;
      const arr = set.get(key) ?? [];
      arr.push(t);
      set.set(key, arr);
    }
    return Array.from(set.entries()).map(([ko, ts]) => ({ ko, topics: ts }));
  }, [topics]);

  const loOptions = useMemo(() => {
    const allowed = selectedKOs.length ? new Set(selectedKOs) : null;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of topics) {
      const key = (t.strand ?? t.title ?? "").trim();
      if (allowed && !allowed.has(key)) continue;
      for (const lo of (t.learning_outcomes ?? [])) {
        if (lo && !seen.has(lo)) { seen.add(lo); out.push(lo); }
      }
    }
    return out;
  }, [topics, selectedKOs]);

  const toggle = (arr: string[], setArr: (v: string[]) => void, v: string) =>
    setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const saveAlignment = async () => {
    setSavingAlign(true);
    const { error } = await supabase
      .from("authentic_ideas")
      .update({ knowledge_outcomes: selectedKOs, learning_outcomes: selectedLOs })
      .eq("id", idea.id);
    setSavingAlign(false);
    if (error) { toast.error(error.message); return; }
    await onChanged();
    toast.success("Alignment saved.");
  };

  const refine = async () => {
    if (!instruction.trim()) return;
    setRefining(true);
    try {
      const { error } = await supabase.functions.invoke("refine-authentic-idea", {
        body: { idea_id: idea.id, instruction: instruction.trim() },
      });
      if (error) throw error;
      setInstruction("");
      await onChanged();
      toast.success("Refined.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Refine failed");
    } finally {
      setRefining(false);
    }
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MODE_COLOR[idea.mode] ?? "bg-muted text-muted-foreground"}`}>
            {MODE_LABEL[idea.mode] ?? idea.mode}
          </span>
        </div>
        <SheetTitle className="text-left">{idea.title}</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-5 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {idea.duration_minutes ? <span>⏱ {idea.duration_minutes} min</span> : null}
          {idea.group_size ? <span>👥 {idea.group_size}</span> : null}
          {idea.ao_codes.length ? <span>🎯 {idea.ao_codes.join(", ")}</span> : null}
        </div>

        {idea.brief ? <p className="text-muted-foreground italic">{idea.brief}</p> : null}

        <section className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Syllabus alignment</h4>
            <Button size="sm" variant="outline" onClick={saveAlignment} disabled={savingAlign}>
              {savingAlign ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save alignment"}
            </Button>
          </div>
          {topics.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Pick a syllabus on this plan to enable KO/LO alignment.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Knowledge outcomes (KOs)</div>
                <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
                  {koOptions.map(({ ko }) => {
                    const active = selectedKOs.includes(ko);
                    return (
                      <button key={ko} type="button" onClick={() => toggle(selectedKOs, setSelectedKOs, ko)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"}`}>
                        {ko}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Learning outcomes (LOs)</div>
                <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
                  {loOptions.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">Select KOs to filter LOs, or leave KOs empty to see all.</span>
                  ) : loOptions.map((lo) => {
                    const active = selectedLOs.includes(lo);
                    return (
                      <button key={lo} type="button" onClick={() => toggle(selectedLOs, setSelectedLOs, lo)}
                        className={`max-w-full truncate rounded-full border px-2 py-0.5 text-left text-[11px] transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"}`}
                        title={lo}>
                        {lo}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>


        {idea.student_brief ? (
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Student brief</h4>
            <p className="whitespace-pre-wrap">{idea.student_brief}</p>
          </section>
        ) : null}

        {idea.materials.length ? (
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materials</h4>
            <ul className="list-disc pl-5">{idea.materials.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </section>
        ) : null}

        {idea.milestones?.length ? (
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Milestones</h4>
            <ul className="list-disc pl-5">{idea.milestones.map((m, i) => <li key={i}><b>{m.when}:</b> {m.label}</li>)}</ul>
          </section>
        ) : null}

        {idea.rubric?.length ? (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rubric</h4>
            <div className="space-y-3">
              {idea.rubric.map((c, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="text-sm font-medium">{c.criterion}</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {c.levels.map((lv, j) => (
                      <div key={j} className="rounded-md bg-muted/40 p-2">
                        <div className="text-xs font-semibold">{lv.label}</div>
                        <div className="text-xs text-muted-foreground">{lv.descriptor}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {idea.teacher_notes ? (
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teacher notes</h4>
            <p className="whitespace-pre-wrap text-muted-foreground">{idea.teacher_notes}</p>
          </section>
        ) : null}

        <section className="border-t border-border pt-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Refine this idea</h4>
          <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2}
            placeholder='e.g. "Make it group-of-4, shorten to one lesson, add an ICT element."' />
          <Button size="sm" onClick={refine} disabled={refining || !instruction.trim()} className="mt-2 gap-2">
            {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Apply
          </Button>
        </section>
      </div>
    </>
  );
}
