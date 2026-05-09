import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download } from "lucide-react";
import { toast } from "sonner";
import { parseMarkingXlsx, type ParsedImport } from "@/lib/marking-import";
import { recomputePointsForPapers } from "@/lib/marking-points";
import { useRoles } from "@/lib/roles";

export const Route = createFileRoute("/oversight/import")({
  component: ImportPage,
  head: () => ({ meta: [{ title: "Import marking deployment · origAImi" }] }),
});

function ImportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canSeeOversight } = useRoles();
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [department, setDepartment] = useState("");
  const [semester, setSemester] = useState("");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [defaultAssessment, setDefaultAssessment] = useState<string>("EoY");
  const [committing, setCommitting] = useState(false);

  const onFile = async (file: File) => {
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      const result = parseMarkingXlsx(buf);
      setParsed(result);
      if (result.papers.length === 0) {
        toast.warning("No deployment rows detected. Check that the sheet has Level/Subject/Marker columns.");
      } else {
        toast.success(`Parsed ${result.papers.length} paper(s) and ${result.papers.reduce((a, p) => a + p.deployments.length, 0)} deployments.`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read the file. Make sure it's an .xlsx export.");
    }
  };

  const commit = async () => {
    if (!parsed || parsed.papers.length === 0) return;
    setCommitting(true);
    try {
      // Resolve names → profile ids via teacher_aliases + profiles.display_name
      const names = parsed.uniqueNames;
      const [{ data: aliases }, { data: profiles }] = await Promise.all([
        supabase.from("teacher_aliases").select("alias, profile_id").in("alias", names.length ? names : [""]),
        supabase.from("profiles").select("id, display_name, full_name").in("display_name", names.length ? names : [""]),
      ]);
      const nameToId = new Map<string, string>();
      for (const a of aliases ?? []) nameToId.set(a.alias, a.profile_id);
      for (const p of profiles ?? []) {
        const dn = (p as { display_name: string | null }).display_name;
        if (dn) nameToId.set(dn, p.id);
      }
      const unmatched = names.filter((n) => !nameToId.has(n));

      let papersCreated = 0;
      let deploymentsCreated = 0;
      const newPaperIds: string[] = [];

      for (const p of parsed.papers) {
        const { data: paperRow, error: pErr } = await supabase
          .from("marking_papers")
          .insert({
            title: p.title,
            subject: p.subject,
            level: p.level,
            stream: p.stream,
            duration_minutes: p.duration_minutes,
            assessment_type: p.assessment_type ?? defaultAssessment ?? null,
            department: department || null,
            remarks: p.remarks,
            semester: semester || null,
            year: year ? parseInt(year, 10) : null,
          })
          .select("id")
          .single();
        if (pErr || !paperRow) {
          console.error("Paper insert failed", pErr);
          continue;
        }
        papersCreated += 1;
        newPaperIds.push(paperRow.id);

        const rows = p.deployments.map((d) => ({
          paper_id: paperRow.id,
          role: d.role,
          teacher_name: d.teacher_name,
          teacher_id: nameToId.get(d.teacher_name) ?? null,
          class_label: d.class_label,
          script_count: d.script_count,
        }));
        if (rows.length > 0) {
          const { error: dErr, count } = await supabase
            .from("marking_deployments")
            .insert(rows, { count: "exact" });
          if (dErr) console.error("Deployment insert failed", dErr);
          else deploymentsCreated += count ?? rows.length;
        }
      }

      // Auto-link G2↔G3 variants and compute setting / marking points
      try {
        await recomputePointsForPapers(supabase as unknown as { from: (t: string) => any }, newPaperIds);
      } catch (e) {
        console.error("Points recompute failed", e);
      }

      await supabase.from("marking_imports").insert({
        user_id: user.id,
        filename,
        department: department || null,
        semester: semester || null,
        year: year ? parseInt(year, 10) : null,
        rows_parsed: parsed.papers.reduce((a, p) => a + p.deployments.length, 0),
        papers_created: papersCreated,
        deployments_created: deploymentsCreated,
        unmatched_names: unmatched,
        errors: parsed.warnings,
      });

      toast.success(`Imported ${papersCreated} paper(s), ${deploymentsCreated} deployment(s).`);
      navigate({ to: "/oversight" });
    } catch (err) {
      console.error(err);
      toast.error("Import failed. Some rows may not have been saved.");
    } finally {
      setCommitting(false);
    }
  };

  if (!canSeeOversight) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-12">
         <Card>
            <CardHeader><CardTitle>You need HOD or School Leader access to import</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>Only HODs, School Leaders and admins can import marking deployments. Ask your HOD to upload the sheet on your behalf.</p>
              <Button asChild variant="outline">
                <Link to="/oversight"><ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const totalDeployments = parsed?.papers.reduce((a, p) => a + p.deployments.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/oversight"><ArrowLeft className="mr-1 h-4 w-4" /> Back to oversight</Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Import setters / markers list</h1>
            <p className="text-sm text-muted-foreground">
              Upload your department spreadsheet to populate the dashboard, or start from a clean template.
              We'll detect Assessment, Level, Subject, Setter, Marker, Classes and per-class script counts automatically.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/templates/setters-markers-template.xlsx" download>
              <Download className="mr-2 h-4 w-4" />Download blank template
            </a>
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">1 · Upload</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label>Department</Label>
                <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Humanities" />
              </div>
              <div className="space-y-1">
                <Label>Semester</Label>
                <Input value={semester} onChange={(e) => setSemester(e.target.value)} placeholder="Semester 2" />
              </div>
              <div className="space-y-1">
                <Label>Year</Label>
                <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Default assessment</Label>
                <Input
                  value={defaultAssessment}
                  onChange={(e) => setDefaultAssessment(e.target.value)}
                  placeholder="EoY / MYE / WA1 …"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Used for any rows that don't have an Assessment column value. Drives points awarded across the year.
            </p>

            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 p-8 text-sm text-muted-foreground hover:bg-muted">
              <FileSpreadsheet className="h-5 w-5" />
              <span>{filename ?? "Choose an .xlsx file…"}</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
          </CardContent>
        </Card>

        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2 · Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge variant="secondary">{parsed.papers.length} papers</Badge>
                <Badge variant="secondary">{totalDeployments} deployments</Badge>
                <Badge variant="secondary">{parsed.uniqueNames.length} unique teachers</Badge>
                {parsed.warnings.length > 0 && (
                  <Badge variant="secondary" className="text-amber-700">
                    <AlertCircle className="mr-1 h-3 w-3" />{parsed.warnings.length} warning(s)
                  </Badge>
                )}
              </div>

              {parsed.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200">
                  <ul className="list-disc pl-4">
                    {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              <div className="max-h-96 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paper</TableHead>
                      <TableHead>Stream</TableHead>
                      <TableHead>Setter(s)</TableHead>
                      <TableHead>Markers</TableHead>
                      <TableHead className="text-right">Total scripts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.papers.map((p, i) => {
                      const setters = p.deployments.filter((d) => d.role === "setter").map((d) => d.teacher_name);
                      const markerSummary = new Map<string, number>();
                      for (const d of p.deployments.filter((x) => x.role === "marker")) {
                        markerSummary.set(d.teacher_name, (markerSummary.get(d.teacher_name) ?? 0) + d.script_count);
                      }
                      const total = Array.from(markerSummary.values()).reduce((a, b) => a + b, 0);
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">
                            {p.title}
                            <div className="text-xs text-muted-foreground">{p.subject} · {p.level}{p.duration_minutes ? ` · ${p.duration_minutes} min` : ""}</div>
                          </TableCell>
                          <TableCell className="text-sm">{p.stream ?? "—"}</TableCell>
                          <TableCell className="text-sm">{setters.join(", ") || "—"}</TableCell>
                          <TableCell className="text-sm">
                            {Array.from(markerSummary.entries()).map(([name, n]) => (
                              <div key={name}>{name} <span className="text-muted-foreground">({n})</span></div>
                            ))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{total}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setParsed(null); setFilename(null); }}>
                  Discard
                </Button>
                <Button onClick={commit} disabled={committing || totalDeployments === 0}>
                  {committing ? "Importing…" : <><CheckCircle2 className="mr-2 h-4 w-4" />Import {totalDeployments} deployment(s)</>}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

void Upload;
