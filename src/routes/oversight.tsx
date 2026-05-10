import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  import_id: string | null;
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
type ImportRow = {
  id: string;
  filename: string | null;
  department: string | null;
  semester: string | null;
  year: number | null;
  rows_parsed: number;
  papers_created: number;
  deployments_created: number;
  created_at: string;
};

function OversightPage() {
  const location = useLocation();
  const isNestedRoute = location.pathname.replace(/\/$/, "") !== "/oversight";
  const { canSeeOversight, isSl } = useRoles();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [assessmentFilter, setAssessmentFilter] = useState<string>("all");

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const [pRes, dRes, iRes] = await Promise.all([
      supabase.from("marking_papers").select("*").order("created_at", { ascending: false }).limit(2000),
      supabase.from("marking_deployments").select("*").limit(5000),
      supabase.from("marking_imports").select("id,filename,department,semester,year,rows_parsed,papers_created,deployments_created,created_at").order("created_at", { ascending: false }).limit(200),
    ]);
    if (pRes.error || dRes.error) {
      const msg = pRes.error?.message ?? dRes.error?.message ?? "Failed to load dashboard data.";
      console.error("[oversight] load failed", pRes.error, dRes.error);
      setLoadError(msg);
    }
    setPapers((pRes.data ?? []) as Paper[]);
    setDeployments((dRes.data ?? []) as Deployment[]);
    setImports((iRes.data ?? []) as ImportRow[]);
    setLoading(false);
  };

  // Reload whenever we (re)enter the dashboard, e.g. after returning from /oversight/import.
  useEffect(() => {
    if (!isNestedRoute) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNestedRoute]);

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

  // Apply paper-level filters (subject + year + assessment) to gate every chart/table downstream
  const paperPasses = (p: Paper | undefined) => {
    if (!p) return false;
    if (subjectFilter !== "all" && (p.subject ?? "") !== subjectFilter) return false;
    if (yearFilter !== "all" && String(p.year ?? "") !== yearFilter) return false;
    if (assessmentFilter !== "all" && (p.assessment_type ?? "") !== assessmentFilter) return false;
    return true;
  };

  const visibleDeployments = useMemo(
    () => deployments.filter((d) => paperPasses(paperById.get(d.paper_id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployments, paperById, subjectFilter, yearFilter, assessmentFilter],
  );

  const markerDeployments = useMemo(() => {
    return visibleDeployments.filter((d) => {
      if (d.role !== "marker") return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (search) {
        const p = paperById.get(d.paper_id);
        const q = search.toLowerCase();
        const hay = `${p?.title ?? ""} ${p?.subject ?? ""} ${p?.level ?? ""} ${d.teacher_name ?? ""} ${d.class_label ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleDeployments, paperById, statusFilter, search]);
  const setterDeployments = useMemo(() => visibleDeployments.filter((d) => d.role === "setter"), [visibleDeployments]);

  const filtered = markerDeployments;

  // KPIs
  const totalAssigned = markerDeployments.reduce((a, d) => a + d.script_count, 0);
  const totalMarked = markerDeployments.reduce((a, d) => a + d.marked_count, 0);
  const totalFlagged = markerDeployments.reduce((a, d) => a + d.flagged_count, 0);
  const pctComplete = totalAssigned > 0 ? Math.round((totalMarked / totalAssigned) * 100) : 0;
  const overdue = markerDeployments.filter(
    (d) => d.due_at && new Date(d.due_at) < new Date() && d.status !== "marking_done" && d.status !== "moderated",
  ).length;
  // Scripts breakdown by level
  const byLevel = useMemo(() => {
    const m = new Map<string, { level: string; papers: Set<string>; assigned: number; marked: number; flagged: number }>();
    for (const d of markerDeployments) {
      const p = paperById.get(d.paper_id);
      const level = p?.level ?? "—";
      const e = m.get(level) ?? { level, papers: new Set<string>(), assigned: 0, marked: 0, flagged: 0 };
      e.papers.add(d.paper_id);
      e.assigned += d.script_count;
      e.marked += d.marked_count;
      e.flagged += d.flagged_count;
      m.set(level, e);
    }
    return Array.from(m.values())
      .map((e) => ({ level: e.level, papers: e.papers.size, assigned: e.assigned, marked: e.marked, flagged: e.flagged }))
      .sort((a, b) => a.level.localeCompare(b.level));
  }, [markerDeployments, paperById]);

  // Per-teacher rollups — markers and setters separately (a setter doesn't necessarily mark, and vice versa)
  const perMarker = useMemo(() => {
    type Entry = {
      name: string;
      assigned: number;
      marked: number;
      flagged: number;
      classes: number;
      classLabels: string[];
      levels: Set<string>;
      subjects: Set<string>;
      papers: Set<string>;
    };
    const m = new Map<string, Entry>();
    for (const d of markerDeployments) {
      const key = d.teacher_name ?? "Unassigned";
      const p = paperById.get(d.paper_id);
      const e = m.get(key) ?? {
        name: key, assigned: 0, marked: 0, flagged: 0, classes: 0,
        classLabels: [], levels: new Set<string>(), subjects: new Set<string>(), papers: new Set<string>(),
      };
      e.assigned += d.script_count;
      e.marked += d.marked_count;
      e.flagged += d.flagged_count;
      e.classes += 1;
      if (d.class_label) e.classLabels.push(d.class_label);
      if (p?.level) e.levels.add(p.level);
      if (p?.subject) e.subjects.add(p.subject);
      if (p?.title) e.papers.add(p.title);
      m.set(key, e);
    }
    return Array.from(m.values())
      .map((e) => ({
        name: e.name,
        assigned: e.assigned,
        marked: e.marked,
        flagged: e.flagged,
        classes: e.classes,
        classLabels: e.classLabels,
        levels: Array.from(e.levels).sort(),
        subjects: Array.from(e.subjects).sort(),
        papers: Array.from(e.papers).sort(),
      }))
      .sort((a, b) => b.assigned - a.assigned);
  }, [markerDeployments, paperById]);

  const settingLoad = useMemo(() => {
    type Entry = {
      name: string;
      points: number;
      paperIds: Set<string>;
      paperTitles: Set<string>;
      subjects: Set<string>;
      levels: Set<string>;
      postingGroups: Set<string>;
      classLabels: Set<string>;
    };
    const m = new Map<string, Entry>();
    for (const d of setterDeployments) {
      const key = d.teacher_name ?? "Unassigned";
      const p = paperById.get(d.paper_id);
      const e = m.get(key) ?? {
        name: key, points: 0,
        paperIds: new Set<string>(), paperTitles: new Set<string>(),
        subjects: new Set<string>(), levels: new Set<string>(),
        postingGroups: new Set<string>(), classLabels: new Set<string>(),
      };
      e.points += Number(d.points) || 0;
      e.paperIds.add(d.paper_id);
      if (p?.title) e.paperTitles.add(p.title);
      if (p?.subject) e.subjects.add(p.subject);
      if (p?.level) e.levels.add(p.level);
      if (p?.stream) e.postingGroups.add(p.stream);
      for (const md of markerDeployments) {
        if (md.paper_id !== d.paper_id) continue;
        if (md.class_label) e.classLabels.add(md.class_label);
      }
      m.set(key, e);
    }
    return Array.from(m.values())
      .map((e) => ({
        name: e.name,
        points: e.points,
        papers: e.paperIds.size,
        paperTitles: Array.from(e.paperTitles).sort(),
        subjects: Array.from(e.subjects).sort(),
        levels: Array.from(e.levels).sort(),
        postingGroups: Array.from(e.postingGroups).sort(),
        classLabels: Array.from(e.classLabels).sort(),
      }))
      .filter((e) => e.points > 0)
      .sort((a, b) => b.points - a.points);
  }, [setterDeployments, markerDeployments, paperById]);

  // Points by teacher and role (deployment-by-points)
  const totalPoints = useMemo(
    () => visibleDeployments.reduce((a, d) => a + (Number(d.points) || 0), 0),
    [visibleDeployments],
  );
  const leaderboard = useMemo(() => {
    const m = new Map<string, { name: string; setting: number; marking: number; moderation: number }>();
    for (const d of visibleDeployments) {
      const key = d.teacher_name ?? "Unassigned";
      const e = m.get(key) ?? { name: key, setting: 0, marking: 0, moderation: 0 };
      const pts = Number(d.points) || 0;
      if (d.role === "setter") e.setting += pts;
      else if (d.role === "marker") e.marking += pts;
      else if (d.role === "moderator") e.moderation += pts;
      m.set(key, e);
    }
    return Array.from(m.values())
      .map((e) => ({ ...e, total: e.setting + e.marking + e.moderation }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [visibleDeployments]);
  const maxLeaderTotal = leaderboard[0]?.total ?? 0;

  // ----- Mutations -----
  const deleteImport = async (imp: ImportRow) => {
    if (!confirm(`Delete import "${imp.filename ?? imp.id}" and all its deployments? This cannot be undone.`)) return;
    // Find papers tagged with this import
    const { data: scopedPapers } = await supabase.from("marking_papers").select("id").eq("import_id", imp.id);
    const paperIds = (scopedPapers ?? []).map((p: { id: string }) => p.id);
    if (paperIds.length > 0) {
      const { data: deps } = await supabase.from("marking_deployments").select("id").in("paper_id", paperIds);
      const depIds = (deps ?? []).map((d: { id: string }) => d.id);
      if (depIds.length > 0) {
        await supabase.from("marking_scripts").delete().in("deployment_id", depIds);
      }
      await supabase.from("marking_deployments").delete().in("paper_id", paperIds);
      await supabase.from("marking_papers").delete().in("id", paperIds);
    }
    await supabase.from("marking_imports").delete().eq("id", imp.id);
    await load();
  };

  const deleteAllDeploymentData = async () => {
    if (!confirm("Delete ALL imported deployment data (papers, deployments, scripts, imports)? This cannot be undone.")) return;
    if (!confirm("Are you sure? This wipes every import and starts fresh.")) return;
    // delete scripts referencing any deployment, then deployments, then papers, then imports
    await supabase.from("marking_scripts").delete().not("deployment_id", "is", null);
    await supabase.from("marking_deployments").delete().not("id", "is", null);
    await supabase.from("marking_papers").delete().not("id", "is", null);
    await supabase.from("marking_imports").delete().not("id", "is", null);
    await load();
  };

  if (isNestedRoute) {
    return <Outlet />;
  }

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
              New here? Download the sample template (15 mock rows per term), replace with your data, then import to see your dashboard data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href="/templates/setters-markers-template.xlsx" download>
                <Download className="mr-2 h-4 w-4" />Download template (with sample data)
              </a>
            </Button>
            <Button asChild>
              <Link to="/oversight/import">
                <Upload className="mr-2 h-4 w-4" />Import deployment sheet
              </Link>
            </Button>
            {imports.length > 0 && (
              <Button variant="destructive" onClick={deleteAllDeploymentData}>
                Clear current deployment
              </Button>
            )}
          </div>
        </div>

        {loadError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Couldn't load dashboard data: {loadError}
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Kpi label="Papers" value={papers.length} />
          <Kpi label="Markers deployed" value={new Set(markerDeployments.map((d) => d.teacher_name ?? "")).size} />
          <Kpi label="Scripts assigned" value={totalAssigned} />
          <Kpi label="% complete" value={`${pctComplete}%`} sub={`${totalMarked}/${totalAssigned}`} />
          <Kpi label="Overdue / Flagged" value={`${overdue} / ${totalFlagged}`} tone={overdue > 0 || totalFlagged > 0 ? "warn" : undefined} />
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
                or <a href="/templates/setters-markers-template.xlsx" download className="underline">download the sample template</a> to get started.
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

        {/* Scripts by level */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileCheck2 className="h-4 w-4" /> Scripts by level
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {byLevel.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No data yet — import a deployment sheet to populate the dashboard.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Level</TableHead>
                    <TableHead className="text-right">Papers</TableHead>
                    <TableHead className="text-right">Scripts assigned</TableHead>
                    <TableHead className="text-right">Marked</TableHead>
                    <TableHead className="text-right">Flagged</TableHead>
                    <TableHead className="text-right">% complete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byLevel.map((r) => {
                    const pct = r.assigned > 0 ? Math.round((r.marked / r.assigned) * 100) : 0;
                    return (
                      <TableRow key={r.level}>
                        <TableCell className="font-medium">{r.level}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.papers}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.assigned}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.marked}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.flagged}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct}%</TableCell>
                      </TableRow>
                    );
                  })}
                  {(() => {
                    const tot = byLevel.reduce(
                      (a, r) => ({ papers: a.papers + r.papers, assigned: a.assigned + r.assigned, marked: a.marked + r.marked, flagged: a.flagged + r.flagged }),
                      { papers: 0, assigned: 0, marked: 0, flagged: 0 },
                    );
                    const pct = tot.assigned > 0 ? Math.round((tot.marked / tot.assigned) * 100) : 0;
                    return (
                      <TableRow className="font-semibold">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right tabular-nums">{tot.papers}</TableCell>
                        <TableCell className="text-right tabular-nums">{tot.assigned}</TableCell>
                        <TableCell className="text-right tabular-nums">{tot.marked}</TableCell>
                        <TableCell className="text-right tabular-nums">{tot.flagged}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct}%</TableCell>
                      </TableRow>
                    );
                  })()}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Scripts assigned per marker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Scripts assigned per marker</CardTitle>
          </CardHeader>
          <CardContent>
            {perMarker.length === 0 ? (
              <div className="text-sm text-muted-foreground">No markers loaded yet.</div>
            ) : (
              <TooltipProvider delayDuration={100}>
                <div className="space-y-3">
                  {(() => {
                    const max = perMarker[0]?.assigned ?? 0;
                    return perMarker.map((t) => (
                      <Tooltip key={t.name}>
                        <TooltipTrigger asChild>
                          <div className="grid grid-cols-12 items-center gap-3 text-sm cursor-default">
                            <div className="col-span-3 font-medium truncate">{t.name}</div>
                            <div className="col-span-6">
                              <div className="h-3 w-full overflow-hidden rounded bg-muted">
                                <div className="h-full bg-emerald-500" style={{ width: `${max > 0 ? Math.round((t.assigned / max) * 100) : 0}%` }} />
                              </div>
                            </div>
                            <div className="col-span-3 text-right tabular-nums text-muted-foreground">
                              {t.assigned} script{t.assigned === 1 ? "" : "s"}
                              {t.flagged > 0 && (
                                <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                                  <AlertTriangle className="h-3 w-3" />{t.flagged}
                                </span>
                              )}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-sm space-y-1">
                          <div className="font-medium">{t.name}</div>
                          <div>Scripts assigned: <span className="tabular-nums">{t.assigned}</span> · Marked: <span className="tabular-nums">{t.marked}</span>{t.flagged > 0 ? <> · Flagged: <span className="tabular-nums">{t.flagged}</span></> : null}</div>
                          <div>Classes ({t.classes}): {t.classLabels.length ? t.classLabels.join(", ") : "—"}</div>
                          <div>Levels: {t.levels.length ? t.levels.join(", ") : "—"}</div>
                          <div>Subjects: {t.subjects.length ? t.subjects.join(", ") : "—"}</div>
                          <div>Papers: {t.papers.length ? t.papers.join("; ") : "—"}</div>
                        </TooltipContent>
                      </Tooltip>
                    ));
                  })()}
                </div>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>

        {/* Setting load */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Setting load (points)</CardTitle>
          </CardHeader>
          <CardContent>
            {settingLoad.length === 0 ? (
              <div className="text-sm text-muted-foreground">No setting points yet.</div>
            ) : (
              <TooltipProvider delayDuration={100}>
                <div className="space-y-3">
                  {(() => {
                    const max = settingLoad[0]?.points ?? 0;
                    return settingLoad.map((t) => (
                      <Tooltip key={t.name}>
                        <TooltipTrigger asChild>
                          <div className="grid grid-cols-12 items-center gap-3 text-sm cursor-default">
                            <div className="col-span-3 font-medium truncate">{t.name}</div>
                            <div className="col-span-6">
                              <div className="h-3 w-full overflow-hidden rounded bg-muted">
                                <div className="h-full bg-violet-500" style={{ width: `${max > 0 ? Math.round((t.points / max) * 100) : 0}%` }} />
                              </div>
                            </div>
                            <div className="col-span-3 text-right tabular-nums text-muted-foreground">{t.points.toFixed(1)} pts</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-sm space-y-1">
                          <div className="font-medium">{t.name}</div>
                          <div>Points: <span className="tabular-nums">{t.points.toFixed(1)}</span> · Papers set: <span className="tabular-nums">{t.papers}</span></div>
                          <div>Subjects: {t.subjects.length ? t.subjects.join(", ") : "—"}</div>
                          <div>Levels: {t.levels.length ? t.levels.join(", ") : "—"}</div>
                          <div>Posting groups: {t.postingGroups.length ? t.postingGroups.join(", ") : "—"}</div>
                          <div>Classes: {t.classLabels.length ? t.classLabels.join(", ") : "—"}</div>
                          <div>Paper titles: {t.paperTitles.length ? t.paperTitles.join("; ") : "—"}</div>
                        </TooltipContent>
                      </Tooltip>
                    ));
                  })()}
                </div>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>
        {/* Imports management */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Uploaded imports</CardTitle>
            {imports.length > 0 && (
              <Button variant="destructive" size="sm" onClick={deleteAllDeploymentData}>
                Delete ALL deployment data
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {imports.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No imports recorded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Year / Semester</TableHead>
                    <TableHead className="text-right">Papers</TableHead>
                    <TableHead className="text-right">Deployments</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map((imp) => (
                    <TableRow key={imp.id}>
                      <TableCell className="font-medium truncate max-w-[260px]">{imp.filename ?? "—"}</TableCell>
                      <TableCell className="text-sm">{imp.department ?? "—"}</TableCell>
                      <TableCell className="text-sm">{[imp.year, imp.semester].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{imp.papers_created}</TableCell>
                      <TableCell className="text-right tabular-nums">{imp.deployments_created}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(imp.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => deleteImport(imp)}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
