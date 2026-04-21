import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "My Assessments · origAImi" }] }),
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

function Dashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState<Assessment[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    setFetching(true);
    const { data } = await supabase
      .from("assessments")
      .select("id,title,subject,level,status,total_marks,duration_minutes,updated_at")
      .order("updated_at", { ascending: false });
    setItems((data as Assessment[]) ?? []);
    setFetching(false);
  };

  useEffect(() => {
    load();
  }, [user]);

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
            <h1 className="font-paper text-3xl font-semibold tracking-tight">My assessments</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Drafts, in review, and finalised papers — all in one place.
            </p>
          </div>
          <Link to="/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create new assessment
            </Button>
          </Link>
        </div>

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
                <AssessmentCard key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

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

function AssessmentCard({ a, onDelete }: { a: Assessment; onDelete: (a: Assessment) => void }) {
  return (
    <div className="group relative rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm">
      <Link
        to="/assessment/$id"
        params={{ id: a.id }}
        className="block"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
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
              <Plus className="h-4 w-4" /> Create new assessment
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}

// Add LEVELS import to silence unused warning when needed
void LEVELS;
