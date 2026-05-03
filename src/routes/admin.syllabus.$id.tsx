import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2, Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/syllabus/$id")({
  component: SyllabusReview,
  head: () => ({ meta: [{ title: "Review syllabus · origAImi" }] }),
});

type Doc = {
  id: string;
  title: string;
  syllabus_code: string | null;
  paper_code: string | null;
  exam_board: string | null;
  syllabus_year: number | null;
  subject: string | null;
  level: string | null;
  parse_status: string;
};

type Paper = {
  id: string;
  paper_number: string;
  paper_code: string | null;
  component_name: string | null;
  marks: number | null;
  weighting_percent: number | null;
  duration_minutes: number | null;
  topic_theme: string | null;
  position: number;
  section: string | null;
  track_tags: string[] | null;
  is_optional: boolean;
  assessment_mode: string | null;
};

type Topic = {
  id: string;
  paper_id: string | null;
  topic_code: string | null;
  parent_code: string | null;
  learning_outcome_code: string | null;
  strand: string | null;
  sub_strand: string | null;
  title: string;
  learning_outcomes: string[];
  suggested_blooms: string[];
  outcome_categories: string[];
  ao_codes: string[];
  depth: number;
  position: number;
  section: string | null;
  ko_content: Record<string, string[]>;
};

type AO = {
  id: string;
  paper_id: string | null;
  code: string;
  title: string | null;
  description: string | null;
  weighting_percent: number | null;
  position: number;
};

const ALL_PAPERS = "__all__";
const UNASSIGNED = "__unassigned__";

function formatDuration(mins: number | null): string {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h${m}`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function SyllabusReview() {
  const { id } = Route.useParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [aos, setAos] = useState<AO[]>([]);
  const [activePaperId, setActivePaperId] = useState<string>(ALL_PAPERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: d }, { data: ps }, { data: ts }, { data: aoData }] = await Promise.all([
      supabase.from("syllabus_documents").select("*").eq("id", id).single(),
      supabase.from("syllabus_papers").select("*").eq("source_doc_id", id).order("position", { ascending: true }),
      supabase.from("syllabus_topics").select("*").eq("source_doc_id", id).order("position", { ascending: true }),
      supabase.from("syllabus_assessment_objectives").select("*").eq("source_doc_id", id).order("position", { ascending: true }),
    ]);
    setDoc(d as Doc);
    setPapers((ps as Paper[]) ?? []);
    setTopics((ts as Topic[]) ?? []);
    setAos((aoData as AO[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const filteredTopics = useMemo(() => {
    if (activePaperId === ALL_PAPERS) return topics.map((t, i) => ({ t, originalIdx: i }));
    if (activePaperId === UNASSIGNED) return topics.map((t, i) => ({ t, originalIdx: i })).filter(({ t }) => !t.paper_id);
    return topics.map((t, i) => ({ t, originalIdx: i })).filter(({ t }) => t.paper_id === activePaperId);
  }, [topics, activePaperId]);

  const updateTopic = (idx: number, patch: Partial<Topic>) => {
    setTopics((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const removeTopic = (idx: number) => {
    setTopics((prev) => prev.filter((_, i) => i !== idx));
  };

  const addTopic = () => {
    const paper_id = activePaperId !== ALL_PAPERS && activePaperId !== UNASSIGNED ? activePaperId : (papers[0]?.id ?? null);
    setTopics((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        paper_id,
        topic_code: null, parent_code: null, learning_outcome_code: null,
        strand: null, sub_strand: null, title: "New topic",
        learning_outcomes: [], suggested_blooms: [],
        outcome_categories: ["knowledge"], ao_codes: [],
        depth: 2, position: prev.length,
        section: null,
        ko_content: {},
      },
    ]);
  };

  const updatePaper = (idx: number, patch: Partial<Paper>) => {
    setPapers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const saveAll = async () => {
    if (!doc) return;
    setSaving(true);
    try {
      const { error: dErr } = await supabase.from("syllabus_documents").update({
        title: doc.title,
        syllabus_code: doc.syllabus_code,
        paper_code: doc.paper_code,
        exam_board: doc.exam_board,
        syllabus_year: doc.syllabus_year,
        subject: doc.subject,
        level: doc.level,
      }).eq("id", id);
      if (dErr) throw dErr;

      // Update each paper individually (preserve ids so topics keep their links)
      for (const p of papers) {
        const { error: pErr } = await supabase.from("syllabus_papers").update({
          paper_number: p.paper_number,
          paper_code: p.paper_code,
          component_name: p.component_name,
          marks: p.marks,
          weighting_percent: p.weighting_percent,
          duration_minutes: p.duration_minutes,
          topic_theme: p.topic_theme,
          section: p.section,
          track_tags: p.track_tags ?? [],
          is_optional: p.is_optional,
          assessment_mode: p.assessment_mode,
        }).eq("id", p.id);
        if (pErr) throw pErr;
      }

      // Replace all topics (keeps logic simple; preserves paper_id from state)
      const { error: delErr } = await supabase.from("syllabus_topics").delete().eq("source_doc_id", id);
      if (delErr) throw delErr;

      if (topics.length > 0) {
        const rows = topics.map((t, i) => ({
          source_doc_id: id,
          paper_id: t.paper_id,
          topic_code: t.topic_code,
          parent_code: t.parent_code,
          learning_outcome_code: t.learning_outcome_code,
          strand: t.strand,
          sub_strand: t.sub_strand,
          title: t.title,
          learning_outcomes: t.learning_outcomes,
          suggested_blooms: t.suggested_blooms,
          outcome_categories: t.outcome_categories ?? [],
          ao_codes: t.ao_codes ?? [],
          depth: t.depth,
          position: i,
          subject: doc.subject,
          level: doc.level,
          section: t.section,
          ko_content: t.ko_content ?? {},
        }));
        const { error: insErr } = await supabase.from("syllabus_topics").insert(rows);
        if (insErr) throw insErr;
      }

      // Replace AOs (similar approach)
      const { error: aoDelErr } = await supabase.from("syllabus_assessment_objectives").delete().eq("source_doc_id", id);
      if (aoDelErr) throw aoDelErr;
      if (aos.length > 0) {
        const aoRows = aos.map((a, i) => ({
          source_doc_id: id,
          paper_id: a.paper_id,
          code: a.code,
          title: a.title,
          description: a.description,
          weighting_percent: a.weighting_percent,
          position: i,
        }));
        const { error: aoInsErr } = await supabase.from("syllabus_assessment_objectives").insert(aoRows);
        if (aoInsErr) throw aoInsErr;
      }

      toast.success("Saved");
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setSaving(true);
    const { error } = await supabase.from("syllabus_documents").update({ parse_status: "published" }).eq("id", id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Published — topics now available in the wizard");
    await load();
  };

  const unassignedCount = topics.filter((t) => !t.paper_id).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </main>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p>Not found.</p>
          <Button asChild variant="outline" className="mt-4"><Link to="/admin/syllabus">Back</Link></Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <div className="sticky top-14 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/syllabus"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{doc.title}</span>
              {doc.syllabus_code && <Badge variant="secondary" className="font-mono">{doc.syllabus_code}</Badge>}
              {doc.exam_board && <Badge variant="outline">{doc.exam_board}</Badge>}
              {doc.syllabus_year && <Badge variant="outline">{doc.syllabus_year}</Badge>}
            </div>
          </div>
          <Button onClick={saveAll} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
          <Button onClick={publish} variant="default" disabled={saving || doc.parse_status === "published"}>
            {doc.parse_status === "published" ? "Published" : "Publish"}
          </Button>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">Review &amp; publish syllabus</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit parsed papers, topics, and assessment objectives, then click <span className="font-medium">Publish</span> to make this syllabus available to the assessment coach and the wizard.
          </p>
        </div>

        {doc.parse_status === "parsing" && (
          <Card className="mb-4 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">Parsing in progress</p>
            <p className="mt-1 opacity-90">
              Refresh in a minute. If it stays in this state, the parser likely failed mid-run — go back to the library and click <span className="font-medium">Reset</span>, then <span className="font-medium">Re-parse</span>.
            </p>
          </Card>
        )}

        {doc.parse_status !== "parsing" && papers.length === 0 && topics.length === 0 && aos.length === 0 && (
          <Card className="mb-4 p-6 text-sm">
            <p className="font-medium">No papers, topics, or assessment objectives were extracted.</p>
            <p className="mt-2 text-muted-foreground">
              The parser ran but produced no structured content. This usually means the PDF is scanned/image-only, or the AI extraction hit a token limit. Go back to the library and click <span className="font-medium">Re-parse</span>. If it keeps failing, try uploading a text-based PDF (not a scan).
            </p>
            <div className="mt-4">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/syllabus"><ArrowLeft className="mr-2 h-4 w-4" />Back to library</Link>
              </Button>
            </div>
          </Card>
        )}

        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Document metadata</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Syllabus code</Label>
              <Input className="font-mono" value={doc.syllabus_code ?? ""} onChange={(e) => setDoc({ ...doc, syllabus_code: e.target.value || null })} />
            </div>
            <div>
              <Label className="text-xs">Exam board</Label>
              <Input value={doc.exam_board ?? ""} onChange={(e) => setDoc({ ...doc, exam_board: e.target.value || null })} />
            </div>
            <div>
              <Label className="text-xs">Year</Label>
              <Input type="number" value={doc.syllabus_year ?? ""} onChange={(e) => setDoc({ ...doc, syllabus_year: e.target.value ? parseInt(e.target.value, 10) : null })} />
            </div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input value={doc.subject ?? ""} onChange={(e) => setDoc({ ...doc, subject: e.target.value || null })} />
            </div>
            <div>
              <Label className="text-xs">Level</Label>
              <Input value={doc.level ?? ""} onChange={(e) => setDoc({ ...doc, level: e.target.value || null })} />
            </div>
          </div>
        </Card>

        {/* Paper switcher */}
        {papers.length > 0 && (
          <Card className="mb-4 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Papers:</span>
              <Button
                variant={activePaperId === ALL_PAPERS ? "default" : "outline"}
                size="sm"
                onClick={() => setActivePaperId(ALL_PAPERS)}
              >
                All ({topics.length})
              </Button>
              {papers.map((p) => {
                const count = topics.filter((t) => t.paper_id === p.id).length;
                const active = activePaperId === p.id;
                return (
                  <Button
                    key={p.id}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActivePaperId(p.id)}
                    className="font-mono"
                  >
                    Paper {p.paper_number}
                    {p.paper_code && <span className="ml-1.5 opacity-70">· {p.paper_code}</span>}
                    {p.component_name && <span className="ml-1.5 font-sans opacity-90">· {p.component_name}</span>}
                    {p.section && <span className="ml-1.5 font-sans opacity-90">· {p.section}</span>}
                    {p.assessment_mode && p.assessment_mode !== "written" && (
                      <span className="ml-1.5 rounded-full bg-background/20 px-1.5 font-sans text-[10px] uppercase">{p.assessment_mode}</span>
                    )}
                    <span className="ml-2 opacity-60">({count})</span>
                  </Button>
                );
              })}
              {unassignedCount > 0 && (
                <Button
                  variant={activePaperId === UNASSIGNED ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActivePaperId(UNASSIGNED)}
                >
                  Unassigned ({unassignedCount})
                </Button>
              )}
            </div>

            {/* Editable paper details for selected paper */}
            {activePaperId !== ALL_PAPERS && activePaperId !== UNASSIGNED && (() => {
              const idx = papers.findIndex((p) => p.id === activePaperId);
              if (idx === -1) return null;
              const p = papers[idx];
              return (
                <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-6">
                  <div>
                    <Label className="text-xs">Paper #</Label>
                    <Input className="font-mono" value={p.paper_number} onChange={(e) => updatePaper(idx, { paper_number: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Paper code</Label>
                    <Input className="font-mono" value={p.paper_code ?? ""} onChange={(e) => updatePaper(idx, { paper_code: e.target.value || null })} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Component name</Label>
                    <Input value={p.component_name ?? ""} onChange={(e) => updatePaper(idx, { component_name: e.target.value || null })} placeholder="e.g. Social Studies" />
                  </div>
                  <div>
                    <Label className="text-xs">Marks</Label>
                    <Input type="number" value={p.marks ?? ""} onChange={(e) => updatePaper(idx, { marks: e.target.value ? parseInt(e.target.value, 10) : null })} />
                  </div>
                  <div>
                    <Label className="text-xs">Duration (min)</Label>
                    <Input
                      type="number"
                      value={p.duration_minutes ?? ""}
                      onChange={(e) => updatePaper(idx, { duration_minutes: e.target.value ? parseInt(e.target.value, 10) : null })}
                      placeholder={formatDuration(p.duration_minutes)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Weighting %</Label>
                    <Input type="number" value={p.weighting_percent ?? ""} onChange={(e) => updatePaper(idx, { weighting_percent: e.target.value ? parseInt(e.target.value, 10) : null })} />
                  </div>
                  <div>
                    <Label className="text-xs">Section</Label>
                    <Input value={p.section ?? ""} onChange={(e) => updatePaper(idx, { section: e.target.value || null })} placeholder="Physics / Chemistry / Biology" />
                  </div>
                  <div>
                    <Label className="text-xs">Mode</Label>
                    <Select value={p.assessment_mode ?? "written"} onValueChange={(v) => updatePaper(idx, { assessment_mode: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="written">Written</SelectItem>
                        <SelectItem value="oral">Oral</SelectItem>
                        <SelectItem value="listening">Listening</SelectItem>
                        <SelectItem value="practical">Practical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Track tags (comma-separated)</Label>
                    <Input
                      className="font-mono text-xs"
                      value={(p.track_tags ?? []).join(", ")}
                      onChange={(e) =>
                        updatePaper(idx, {
                          track_tags: e.target.value
                            .split(",")
                            .map((s) => s.trim().toLowerCase())
                            .filter(Boolean),
                        })
                      }
                      placeholder="physics, chemistry, biology"
                    />
                  </div>
                  {p.topic_theme && (
                    <div className="sm:col-span-6">
                      <Label className="text-xs">Theme</Label>
                      <Input value={p.topic_theme} onChange={(e) => updatePaper(idx, { topic_theme: e.target.value || null })} />
                    </div>
                  )}
                </div>
              );
            })()}
          </Card>
        )}

        {/* Assessment Objectives panel */}
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Assessment Objectives</h2>
              <p className="text-xs text-muted-foreground">Construct validity reference. Empty = syllabus does not publish AOs.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setAos((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    paper_id: activePaperId !== ALL_PAPERS && activePaperId !== UNASSIGNED ? activePaperId : null,
                    code: `AO${prev.length + 1}`,
                    title: null,
                    description: null,
                    weighting_percent: null,
                    position: prev.length,
                  },
                ])
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Add AO
            </Button>
          </div>
          {aos.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No AOs extracted. Add manually if your syllabus publishes them.</p>
          ) : (
            <div className="space-y-2">
              {aos
                .filter((a) => activePaperId === ALL_PAPERS || !a.paper_id || a.paper_id === activePaperId)
                .map((a) => {
                  const idx = aos.findIndex((x) => x.id === a.id);
                  return (
                    <div key={a.id} className="grid grid-cols-1 gap-2 rounded-md border border-border p-2 sm:grid-cols-12">
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Code</Label>
                        <Input className="font-mono" value={a.code} onChange={(e) => setAos((prev) => prev.map((x, i) => i === idx ? { ...x, code: e.target.value } : x))} />
                      </div>
                      <div className="sm:col-span-3">
                        <Label className="text-xs">Title</Label>
                        <Input value={a.title ?? ""} onChange={(e) => setAos((prev) => prev.map((x, i) => i === idx ? { ...x, title: e.target.value || null } : x))} placeholder="Knowledge with Understanding" />
                      </div>
                      <div className="sm:col-span-5">
                        <Label className="text-xs">Description</Label>
                        <Input value={a.description ?? ""} onChange={(e) => setAos((prev) => prev.map((x, i) => i === idx ? { ...x, description: e.target.value || null } : x))} />
                      </div>
                      <div className="sm:col-span-1">
                        <Label className="text-xs">% wt</Label>
                        <Input type="number" value={a.weighting_percent ?? ""} onChange={(e) => setAos((prev) => prev.map((x, i) => i === idx ? { ...x, weighting_percent: e.target.value ? parseInt(e.target.value, 10) : null } : x))} />
                      </div>
                      <div className="flex items-end justify-end sm:col-span-1">
                        <Button variant="ghost" size="sm" onClick={() => setAos((prev) => prev.filter((x) => x.id !== a.id))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">
            Extracted topics ({filteredTopics.length}{filteredTopics.length !== topics.length ? ` of ${topics.length}` : ""})
          </h2>
          <Button variant="outline" size="sm" onClick={addTopic}>
            <Plus className="mr-2 h-4 w-4" />Add topic
          </Button>
        </div>

        {filteredTopics.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {topics.length === 0
              ? "No topics extracted yet. Try re-parsing from the library page."
              : "No topics in this paper. Switch papers above or add a new topic."}
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredTopics.map(({ t, originalIdx }) => (
              <Card key={t.id} className="p-3" style={{ marginLeft: `${Math.min(t.depth, 4) * 16}px` }}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Topic code</Label>
                    <Input
                      className="font-mono text-sm"
                      placeholder="1.2.3"
                      value={t.topic_code ?? ""}
                      onChange={(e) => updateTopic(originalIdx, { topic_code: e.target.value || null })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Parent code</Label>
                    <Input
                      className="font-mono text-sm"
                      placeholder="1.2"
                      value={t.parent_code ?? ""}
                      onChange={(e) => updateTopic(originalIdx, { parent_code: e.target.value || null })}
                    />
                  </div>
                  <div className="sm:col-span-6">
                    <Label className="text-xs">Title</Label>
                    <Input
                      value={t.title}
                      onChange={(e) => updateTopic(originalIdx, { title: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Label className="text-xs">Depth</Label>
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      value={t.depth}
                      onChange={(e) => updateTopic(originalIdx, { depth: parseInt(e.target.value, 10) || 0 })}
                    />
                  </div>
                  <div className="flex items-end justify-end sm:col-span-1">
                    <Button variant="ghost" size="sm" onClick={() => removeTopic(originalIdx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="sm:col-span-3">
                    <Label className="text-xs">Section</Label>
                    <Input
                      value={t.section ?? ""}
                      onChange={(e) => updateTopic(originalIdx, { section: e.target.value || null })}
                      placeholder="Physics / Chemistry / Biology"
                    />
                  </div>
                  {/* Paper assignment selector */}
                  {papers.length > 1 && (
                    <div className="sm:col-span-12">
                      <Label className="text-xs text-muted-foreground">Belongs to paper</Label>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {papers.map((p) => (
                          <Button
                            key={p.id}
                            variant={t.paper_id === p.id ? "default" : "outline"}
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => updateTopic(originalIdx, { paper_id: p.id })}
                          >
                            Paper {p.paper_number}
                          </Button>
                        ))}
                        <Button
                          variant={t.paper_id === null ? "default" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => updateTopic(originalIdx, { paper_id: null })}
                        >
                          Unassigned
                        </Button>
                      </div>
                    </div>
                  )}
                  {(t.learning_outcomes?.length ?? 0) > 0 && (
                    <div className="sm:col-span-12">
                      <Label className="text-xs text-muted-foreground">Learning outcomes</Label>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                        {t.learning_outcomes.map((lo, i) => <li key={i}>{lo}</li>)}
                      </ul>
                    </div>
                  )}
                  {((t.suggested_blooms?.length ?? 0) > 0 || (t.outcome_categories?.length ?? 0) > 0 || (t.ao_codes?.length ?? 0) > 0) && (
                    <div className="flex flex-wrap gap-1 sm:col-span-12">
                      {(t.suggested_blooms ?? []).map((b) => (
                        <Badge key={`b-${b}`} variant="outline" className="text-xs">{b}</Badge>
                      ))}
                      {(t.outcome_categories ?? []).map((c) => (
                        <Badge key={`c-${c}`} variant="secondary" className="text-xs capitalize">{c}</Badge>
                      ))}
                      {(t.ao_codes ?? []).map((a) => (
                        <Badge key={`a-${a}`} className="bg-primary/15 text-xs font-mono text-primary hover:bg-primary/20">{a}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
