import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2, Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/syllabus/$id")({
  component: SyllabusReview,
  head: () => ({ meta: [{ title: "Review syllabus · Joy of Assessment" }] }),
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

type Topic = {
  id: string;
  topic_code: string | null;
  parent_code: string | null;
  learning_outcome_code: string | null;
  strand: string | null;
  sub_strand: string | null;
  title: string;
  learning_outcomes: string[];
  suggested_blooms: string[];
  depth: number;
  position: number;
};

function SyllabusReview() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: d }, { data: ts }] = await Promise.all([
      supabase.from("syllabus_documents").select("*").eq("id", id).single(),
      supabase.from("syllabus_topics").select("*").eq("source_doc_id", id).order("position", { ascending: true }),
    ]);
    setDoc(d as Doc);
    setTopics((ts as Topic[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const updateTopic = (idx: number, patch: Partial<Topic>) => {
    setTopics((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const removeTopic = (idx: number) => {
    setTopics((prev) => prev.filter((_, i) => i !== idx));
  };

  const addTopic = () => {
    setTopics((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        topic_code: null, parent_code: null, learning_outcome_code: null,
        strand: null, sub_strand: null, title: "New topic",
        learning_outcomes: [], suggested_blooms: [],
        depth: 2, position: prev.length,
      },
    ]);
  };

  const saveAll = async () => {
    if (!doc) return;
    setSaving(true);
    try {
      // Update doc
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

      // Replace all topics
      const { error: delErr } = await supabase.from("syllabus_topics").delete().eq("source_doc_id", id);
      if (delErr) throw delErr;

      if (topics.length > 0) {
        const rows = topics.map((t, i) => ({
          source_doc_id: id,
          topic_code: t.topic_code,
          parent_code: t.parent_code,
          learning_outcome_code: t.learning_outcome_code,
          strand: t.strand,
          sub_strand: t.sub_strand,
          title: t.title,
          learning_outcomes: t.learning_outcomes,
          suggested_blooms: t.suggested_blooms,
          depth: t.depth,
          position: i,
          subject: doc.subject,
          level: doc.level,
        }));
        const { error: insErr } = await supabase.from("syllabus_topics").insert(rows);
        if (insErr) throw insErr;
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

      {/* Sticky doc-level header */}
      <div className="sticky top-14 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/syllabus"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{doc.title}</span>
              {doc.syllabus_code && <Badge variant="secondary" className="font-mono">{doc.syllabus_code}</Badge>}
              {doc.paper_code && <Badge variant="outline" className="font-mono">Paper {doc.paper_code}</Badge>}
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
        {/* Doc metadata editor */}
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
              <Label className="text-xs">Paper code</Label>
              <Input className="font-mono" value={doc.paper_code ?? ""} onChange={(e) => setDoc({ ...doc, paper_code: e.target.value || null })} />
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

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Extracted topics ({topics.length})</h2>
          <Button variant="outline" size="sm" onClick={addTopic}>
            <Plus className="mr-2 h-4 w-4" />Add topic
          </Button>
        </div>

        {topics.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No topics extracted yet. Try re-parsing from the library page.
          </Card>
        ) : (
          <div className="space-y-2">
            {topics.map((t, idx) => (
              <Card key={t.id} className="p-3" style={{ marginLeft: `${Math.min(t.depth, 4) * 16}px` }}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Topic code</Label>
                    <Input
                      className="font-mono text-sm"
                      placeholder="1.2.3"
                      value={t.topic_code ?? ""}
                      onChange={(e) => updateTopic(idx, { topic_code: e.target.value || null })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Parent code</Label>
                    <Input
                      className="font-mono text-sm"
                      placeholder="1.2"
                      value={t.parent_code ?? ""}
                      onChange={(e) => updateTopic(idx, { parent_code: e.target.value || null })}
                    />
                  </div>
                  <div className="sm:col-span-6">
                    <Label className="text-xs">Title</Label>
                    <Input
                      value={t.title}
                      onChange={(e) => updateTopic(idx, { title: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Label className="text-xs">Depth</Label>
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      value={t.depth}
                      onChange={(e) => updateTopic(idx, { depth: parseInt(e.target.value, 10) || 0 })}
                    />
                  </div>
                  <div className="flex items-end justify-end sm:col-span-1">
                    <Button variant="ghost" size="sm" onClick={() => removeTopic(idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {(t.learning_outcomes?.length ?? 0) > 0 && (
                    <div className="sm:col-span-12">
                      <Label className="text-xs text-muted-foreground">Learning outcomes</Label>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                        {t.learning_outcomes.map((lo, i) => <li key={i}>{lo}</li>)}
                      </ul>
                    </div>
                  )}
                  {(t.suggested_blooms?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 sm:col-span-12">
                      {t.suggested_blooms.map((b) => (
                        <Badge key={b} variant="outline" className="text-xs">{b}</Badge>
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
