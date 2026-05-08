import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileEdit, FileText, Search, Trash2, Layers, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Assessments · origAImi" }] }),
});

type Assessment = {
  id: string;
  title: string;
  subject: string;
  level: string;
  status: string;
  total_marks: number;
  duration_minutes: number;
  updated_at: string;
};

type PaperSet = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  updated_at: string;
};

type WaPlan = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  unit_focus: string | null;
  status: string;
  updated_at: string;
};

type WaPlanWithCounts = WaPlan & { ideas_total: number; ideas_saved: number };

function Dashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState<Assessment[]>([]);
  const [sets, setSets] = useState<PaperSet[]>([]);
  const [waPlans, setWaPlans] = useState<WaPlanWithCounts[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    setFetching(true);
    const [{ data }, { data: setData }, { data: planData }, { data: ideaData }] = await Promise.all([
      supabase
        .from("assessments")
        .select("id,title,subject,level,status,total_marks,duration_minutes,updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("paper_sets")
        .select("id,title,subject,level,updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("authentic_plans")
        .select("id,title,subject,level,unit_focus,status,updated_at")
        .order("updated_at", { ascending: false })
        .limit(24),
      supabase
        .from("authentic_ideas")
        .select("plan_id,status"),
    ]);
    const counts = new Map<string, { total: number; saved: number }>();
    for (const i of (ideaData as { plan_id: string; status: string }[]) ?? []) {
      const c = counts.get(i.plan_id) ?? { total: 0, saved: 0 };
      c.total++;
      if (i.status === "saved") c.saved++;
      counts.set(i.plan_id, c);
    }
    const plans: WaPlanWithCounts[] = ((planData as WaPlan[]) ?? []).map((p) => ({
      ...p,
      ideas_total: counts.get(p.id)?.total ?? 0,
      ideas_saved: counts.get(p.id)?.saved ?? 0,
    }));
    setItems((data as Assessment[]) ?? []);
    setSets((setData as PaperSet[]) ?? []);
    setWaPlans(plans);
    setFetching(false);
  };

  useEffect(() => {
    load();
  }, [user]);

  const handleDeleteWaPlan = async (p: WaPlanWithCounts) => {
    if (!confirm(`Delete WA plan "${p.title}"? This will also remove all generated ideas.`)) return;
    await supabase.from("authentic_ideas").delete().eq("plan_id", p.id);
    const { error } = await supabase.from("authentic_plans").delete().eq("id", p.id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    setWaPlans((prev) => prev.filter((x) => x.id !== p.id));
    toast.success("WA plan deleted");
  };

  const handleDelete = async (a: Assessment) => {
    if (!confirm(`Delete "${a.title}"? This will also remove its questions and version history.`)) return;
    // Cascade-delete dependent rows first (no FK cascade is set in trial mode).
    await supabase.from("assessment_questions").delete().eq("assessment_id", a.id);
    await supabase.from("assessment_versions").delete().eq("assessment_id", a.id);
    const { error } = await supabase.from("assessments").delete().eq("id", a.id);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== a.id));
    toast.success("Assessment deleted");
  };

  const filtered = items.filter((a) => {
    if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (subjectFilter !== "all" && a.subject !== subjectFilter) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-paper text-3xl font-semibold tracking-tight">Assessments</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Drafts, in review, and finalised papers — all in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/paper-set/new">
              <Button variant="outline" className="gap-2">
                <Layers className="h-4 w-4" /> Review paper set
              </Button>
            </Link>
            <Link to="/authentic/new">
              <Button variant="outline" className="gap-2 bg-teal-600 text-white hover:bg-teal-500 border-teal-500">
                <Lightbulb className="h-4 w-4" /> Generate WA idea
              </Button>
            </Link>
            <Link to="/new">
              <Button className="gap-2">
                <FileEdit className="h-4 w-4" /> Create new assessment
              </Button>
            </Link>
          </div>
        </div>

        {sets.length > 0 ? (
          <section className="mt-6 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">Paper sets</h2>
              <span className="text-xs text-muted-foreground">— macro coverage across multiple papers</span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sets.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/paper-set/$id"
                    params={{ id: s.id }}
                    className="block rounded-lg border border-border px-3 py-2 hover:border-primary/40"
                  >
                    <div className="text-sm font-medium truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground">{s.subject} · {s.level}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {waPlans.length > 0 ? (
          <section className="mt-6 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="h-4 w-4 text-teal-600" />
              <h2 className="text-sm font-medium">WA plans</h2>
              <span className="text-xs text-muted-foreground">— authentic assessment ideas you've generated</span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {waPlans.map((p) => (
                <li key={p.id} className="group relative">
                  <Link
                    to="/authentic/$id"
                    params={{ id: p.id }}
                    className="block rounded-lg border border-border px-3 py-2 pr-9 hover:border-primary/40"
                  >
                    <div className="text-sm font-medium truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[p.subject, p.level, p.unit_focus].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{p.ideas_total} idea{p.ideas_total === 1 ? "" : "s"}</span>
                      {p.ideas_saved > 0 ? <span>· {p.ideas_saved} saved</span> : null}
                      <span>· Updated {new Date(p.updated_at).toLocaleDateString()}</span>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteWaPlan(p); }}
                    aria-label={`Delete ${p.title}`}
                    className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title..."
              className="pl-9"
            />
          </div>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="in_review">In review</SelectItem>
              <SelectItem value="finalised">Finalised</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-6">
          {fetching ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasAny={items.length > 0} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => (
                <AssessmentCard key={a.id} a={a} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const SUBJECT_ICON_STYLES: Record<string, string> = {
  Mathematics: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  Science: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  "English Language": "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "Mother Tongue": "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  Humanities: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
};

function AssessmentCard({ a, onDelete }: { a: Assessment; onDelete: (a: Assessment) => void }) {
  const iconStyle = SUBJECT_ICON_STYLES[a.subject] ?? "bg-primary-soft text-primary";
  return (
    <div className="group relative rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm">
      <Link
        to="/assessment/$id"
        params={{ id: a.id }}
        className="block"
      >
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconStyle}`} aria-label={`${a.subject} icon`}>
            <FileText className="h-5 w-5" />
          </div>
          <StatusBadge status={a.status} />
        </div>
        <h3 className="mt-4 line-clamp-2 pr-8 font-medium text-foreground group-hover:text-primary">
          {a.title}
        </h3>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{a.subject}</span>
          <span>·</span>
          <span>{a.level}</span>
          <span>·</span>
          <span>{a.total_marks} marks</span>
          <span>·</span>
          <span>{a.duration_minutes} min</span>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Updated {new Date(a.updated_at).toLocaleDateString()}
        </div>
      </Link>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(a); }}
        aria-label={`Delete ${a.title}`}
        className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
    in_review: { label: "In review", className: "bg-warm text-warm-foreground" },
    finalised: { label: "Finalised", className: "bg-success/15 text-success" },
  };
  const m = map[status] ?? map.draft;
  return <Badge variant="secondary" className={m.className}>{m.label}</Badge>;
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <FileText className="h-6 w-6" />
      </div>
      <h3 className="mt-4 font-medium text-foreground">
        {hasAny ? "No matches" : "Ready to unfold a new paper?"}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {hasAny
          ? "Try adjusting your search or filters."
          : "Define a TOS, let AI draft a paper, then add your expert touches."}
      </p>
      {!hasAny && (
        <>
          <div className="mx-auto mt-6 flex max-w-lg flex-wrap justify-center gap-2">
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              Effortless Generation
            </span>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              Intelligent Coaching
            </span>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              Curated Inspiration
            </span>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              Precision Alignment
            </span>
          </div>
          <Link to="/new" className="mt-6 inline-block">
            <Button className="gap-2">
              <FileEdit className="h-4 w-4" /> Create new assessment
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}

// Add LEVELS import to silence unused warning when needed
void LEVELS;
