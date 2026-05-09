import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Upload, Users, FileCheck2, AlertTriangle, Download } from "lucide-react";
import { useRoles } from "@/lib/roles";

export const Route = createFileRoute("/oversight")({
  component: OversightPage,
  head: () => ({ meta: [{ title: "Dashboard · origAImi" }] }),
});

type Paper = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  stream: string | null;
  department: string | null;
  remarks: string | null;
  assessment_type: string | null;
  variant_of: string | null;
  points_setting: number | null;
  year: number | null;
};
type Deployment = {
  id: string;
  paper_id: string;
  role: "setter" | "marker" | "moderator";
  teacher_name: string | null;
  teacher_id: string | null;
  class_label: string | null;
  script_count: number;
  marked_count: number;
  flagged_count: number;
  status: "assigned" | "in_progress" | "marking_done" | "moderated";
  due_at: string | null;
  points: number | null;
};

function OversightPage() {
  const { canSeeOversight, isSl } = useRoles();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [assessmentFilter, setAssessmentFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const [{ data: pData }, { data: dData }] = await Promise.all([
      supabase.from("marking_papers").select("*").order("created_at", { ascending: false }),
      supabase.from("marking_deployments").select("*"),
    ]);
    setPapers((pData ?? []) as Paper[]);
    setDeployments((dData ?? []) as Deployment[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const paperById = useMemo(() => {
    const m = new Map<string, Paper>();
    for (const p of papers) m.set(p.id, p);
    return m;
  }, [papers]);

  const subjects = useMemo(
    () => Array.from(new Set(papers.map((p) => p.subject).filter((x): x is string => !!x))).sort(),
    [papers],
  );
  const years = useMemo(
    () => Array.from(new Set(papers.map((p) => p.year).filter((x): x is number => x != null))).sort((a, b) => b - a),
    [papers],
  );
  const assessments = useMemo(
    () => Array.from(new Set(papers.map((p) => p.assessment_type).filter((x): x is string => !!x))).sort(),
    [papers],
  );

  // Apply year + assessment filters at the paper level
  const paperPasses = (p: Paper | undefined) => {
    if (!p) return false;
    if (yearFilter !== "all" && String(p.year ?? "") !== yearFilter) return false;
    if (assessmentFilter !== "all" && (p.assessment_type ?? "") !== assessmentFilter) return false;
    return true;
  };

  const visibleDeployments = useMemo(
    () => deployments.filter((d) => paperPasses(paperById.get(d.paper_id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployments, paperById, yearFilter, assessmentFilter],
  );

  const markerDeployments = useMemo(() => visibleDeployments.filter((d) => d.role === "marker"), [visibleDeployments]);
  const setterDeployments = useMemo(() => visibleDeployments.filter((d) => d.role === "setter"), [visibleDeployments]);

  const filtered = useMemo(() => {
    return markerDeployments.filter((d) => {
      const p = paperById.get(d.paper_id);
      if (!p) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (subjectFilter !== "all" && p.subject !== subjectFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${p.title} ${p.subject ?? ""} ${p.level ?? ""} ${d.teacher_name ?? ""} ${d.class_label ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [markerDeployments, paperById, statusFilter, subjectFilter, search]);

  // KPIs
  const totalAssigned = markerDeployments.reduce((a, d) => a + d.script_count, 0);
  const totalMarked = markerDeployments.reduce((a, d) => a + d.marked_count, 0);
  const totalFlagged = markerDeployments.reduce((a, d) => a + d.flagged_count, 0);
  const pctComplete = totalAssigned > 0 ? Math.round((totalMarked / totalAssigned) * 100) : 0;
  const overdue = markerDeployments.filter(
    (d) => d.due_at && new Date(d.due_at) < new Date() && d.status !== "marking_done" && d.status !== "moderated",
  ).length;
  const totalPoints = visibleDeployments.reduce((a, d) => a + (Number(d.points) || 0), 0);

  // Per-teacher rollup (marker scripts)
  const perTeacher = useMemo(() => {
    const m = new Map<string, { name: string; assigned: number; marked: number; flagged: number; deployments: number }>();
    for (const d of markerDeployments) {
      const key = d.teacher_name ?? "Unassigned";
      const e = m.get(key) ?? { name: key, assigned: 0, marked: 0, flagged: 0, deployments: 0 };
      e.assigned += d.script_count;
      e.marked += d.marked_count;
      e.flagged += d.flagged_count;
      e.deployments += 1;
      m.set(key, e);
    }
    return Array.from(m.values()).sort((a, b) => b.assigned - a.assigned);
  }, [markerDeployments]);

  // Per-teacher points leaderboard (setting / marking / moderation)
  const leaderboard = useMemo(() => {
    const m = new Map<string, { name: string; setting: number; marking: number; moderation: number; total: number }>();
    for (const d of visibleDeployments) {
      const key = d.teacher_name ?? "Unassigned";
      const e = m.get(key) ?? { name: key, setting: 0, marking: 0, moderation: 0, total: 0 };
      const pts = Number(d.points) || 0;
      if (d.role === "setter") e.setting += pts;
      else if (d.role === "marker") e.marking += pts;
      else if (d.role === "moderator") e.moderation += pts;
      e.total += pts;
      m.set(key, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [visibleDeployments]);
  const maxLeaderTotal = Math.max(1, ...leaderboard.map((t) => t.total));

  if (!canSeeOversight) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-12">
          <Card>
            <CardHeader><CardTitle>Dashboard</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              This area is for HODs and School Leaders. Ask an admin to grant your account a role to view it.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
         <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Marking dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Setters, markers, scripts and progress {isSl ? "across the school" : "in your department"}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              New here? Download the blank template, fill in your setters/markers, then import to see your dashboard data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href="/templates/setters-markers-template.xlsx" download>
                <Download className="mr-2 h-4 w-4" />Download blank template
              </a>
            </Button>
            <Button asChild>
              <Link to="/oversight/import">
                <span className="inline-flex items-center">
                  <Upload className="mr-2 h-4 w-4" />Import deployment sheet
                </span>
              </Link>
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Kpi label="Papers" value={papers.length} />
          <Kpi label="Markers deployed" value={new Set(markerDeployments.map((d) => d.teacher_name ?? "")).size} />
          <Kpi label="Scripts assigned" value={totalAssigned} />
          <Kpi label="% complete" value={`${pctComplete}%`} sub={`${totalMarked}/${totalAssigned}`} />
          <Kpi label="Overdue / Flagged" value={`${overdue} / ${totalFlagged}`} tone={overdue > 0 || totalFlagged > 0 ? "warn" : undefined} />
          <Kpi label="Points awarded" value={totalPoints.toFixed(1)} sub="set + mark + mod" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search paper, teacher, class…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={assessmentFilter} onValueChange={setAssessmentFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Assessment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assessments</SelectItem>
              {assessments.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="marking_done">Marking done</SelectItem>
              <SelectItem value="moderated">Moderated</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" asChild className="ml-auto">
            <Link to="/oversight/points">Dashboard leaderboard →</Link>
          </Button>
        </div>

        {/* Deployment table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Marker deployments</CardTitle>
            <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
             <div className="p-8 text-center text-sm text-muted-foreground">
                No deployments yet.{" "}
                <Link to="/oversight/import" className="underline">Import your setters/markers list</Link>{" "}
                or <a href="/templates/setters-markers-template.xlsx" download className="underline">download the blank template</a> to get started.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paper</TableHead>
                    <TableHead>Setter</TableHead>
                    <TableHead>Marker</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Assigned</TableHead>
                    <TableHead className="text-right">Marked</TableHead>
                    <TableHead className="w-40">Progress</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => {
                    const p = paperById.get(d.paper_id);
                    const setters = setterDeployments
                      .filter((s) => s.paper_id === d.paper_id)
                      .map((s) => s.teacher_name)
                      .filter(Boolean)
                      .join(", ");
                    const pct = d.script_count > 0 ? Math.round((d.marked_count / d.script_count) * 100) : 0;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          {p?.title}
                          <div className="text-xs text-muted-foreground">
                            {[p?.subject, p?.level, p?.stream].filter(Boolean).join(" · ")}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{setters || "—"}</TableCell>
                        <TableCell className="text-sm">{d.teacher_name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{d.class_label ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.script_count}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.marked_count}</TableCell>
                        <TableCell><Progress value={pct} /></TableCell>
                        <TableCell><StatusBadge status={d.status} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Dashboard leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileCheck2 className="h-4 w-4" /> Dashboard leaderboard
              <span className="text-xs font-normal text-muted-foreground ml-2">
                Contributions across the year
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard.length === 0 ? (
              <div className="text-sm text-muted-foreground">No points awarded yet — import a deployment sheet to get started.</div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((t) => {
                  const pctSet = (t.setting / maxLeaderTotal) * 100;
                  const pctMark = (t.marking / maxLeaderTotal) * 100;
                  const pctMod = (t.moderation / maxLeaderTotal) * 100;
                  return (
                    <div key={t.name} className="grid grid-cols-12 items-center gap-3 text-sm">
                      <div className="col-span-3 font-medium truncate">{t.name}</div>
                      <div className="col-span-6 flex h-3 overflow-hidden rounded-full bg-muted">
                        <div className="bg-primary" style={{ width: `${pctSet}%` }} title={`Setting ${t.setting.toFixed(1)}`} />
                        <div className="bg-emerald-500" style={{ width: `${pctMark}%` }} title={`Marking ${t.marking.toFixed(1)}`} />
                        <div className="bg-violet-500" style={{ width: `${pctMod}%` }} title={`Moderation ${t.moderation.toFixed(1)}`} />
                      </div>
                      <div className="col-span-3 text-right tabular-nums">
                        <span className="font-semibold">{t.total.toFixed(1)}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          ({t.setting.toFixed(1)} / {t.marking.toFixed(1)} / {t.moderation.toFixed(1)})
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 flex gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-primary inline-block" /> Setting</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-500 inline-block" /> Marking</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-violet-500 inline-block" /> Moderation</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-teacher */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Per-teacher load</CardTitle>
          </CardHeader>
          <CardContent>
            {perTeacher.length === 0 ? (
              <div className="text-sm text-muted-foreground">No teachers loaded yet.</div>
            ) : (
              <div className="space-y-3">
                {perTeacher.map((t) => {
                  const pct = t.assigned > 0 ? Math.round((t.marked / t.assigned) * 100) : 0;
                  return (
                    <div key={t.name} className="grid grid-cols-12 items-center gap-3 text-sm">
                      <div className="col-span-3 font-medium truncate">{t.name}</div>
                      <div className="col-span-6"><Progress value={pct} /></div>
                      <div className="col-span-3 text-right tabular-nums text-muted-foreground">
                        {t.marked}/{t.assigned} marked · {t.deployments} class{t.deployments === 1 ? "" : "es"}
                        {t.flagged > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="h-3 w-3" /> {t.flagged}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "warn" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: Deployment["status"] }) {
  const map: Record<Deployment["status"], { label: string; cls: string }> = {
    assigned: { label: "Assigned", cls: "bg-muted text-muted-foreground" },
    in_progress: { label: "In progress", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
    marking_done: { label: "Marked", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    moderated: { label: "Moderated", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  };
  const m = map[status];
  return <Badge variant="secondary" className={m.cls}>{m.label}</Badge>;
}

// Silence unused-import warning for FileCheck2 in some builds; reserved for future panel.
void FileCheck2;
