import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";
import { Upload, FileText, Loader2, Eye, Trash2, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/admin/syllabus/")({
  component: SyllabusAdmin,
  head: () => ({ meta: [{ title: "Syllabus Library · Joy of Assessment" }] }),
});

type SyllabusDoc = {
  id: string;
  title: string;
  syllabus_code: string | null;
  paper_code: string | null;
  exam_board: string | null;
  syllabus_year: number | null;
  subject: string | null;
  level: string | null;
  file_path: string;
  mime_type: string | null;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
};

function SyllabusAdmin() {
  const [docs, setDocs] = useState<SyllabusDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [parsingId, setParsingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload form
  const [title, setTitle] = useState("");
  const [syllabusCode, setSyllabusCode] = useState("");
  const [paperCode, setPaperCode] = useState("");
  const [examBoard, setExamBoard] = useState("MOE");
  const [syllabusYear, setSyllabusYear] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [level, setLevel] = useState<string>("");

  const [paperCounts, setPaperCounts] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: papers }] = await Promise.all([
      supabase.from("syllabus_documents").select("*").order("created_at", { ascending: false }),
      supabase.from("syllabus_papers").select("source_doc_id"),
    ]);
    const counts: Record<string, number> = {};
    for (const p of (papers as { source_doc_id: string }[] | null) ?? []) {
      counts[p.source_doc_id] = (counts[p.source_doc_id] ?? 0) + 1;
    }
    setPaperCounts(counts);
    setDocs((data as SyllabusDoc[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Choose a file first"); return; }
    if (!title.trim()) { toast.error("Title is required"); return; }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("syllabi").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data: row, error: insErr } = await supabase
        .from("syllabus_documents")
        .insert({
          title: title.trim(),
          syllabus_code: syllabusCode.trim() || null,
          paper_code: paperCode.trim() || null,
          exam_board: examBoard,
          syllabus_year: syllabusYear ? parseInt(syllabusYear, 10) : null,
          subject: subject || null,
          level: level || null,
          file_path: path,
          mime_type: file.type,
          parse_status: "pending",
        })
        .select()
        .single();
      if (insErr) throw insErr;

      toast.success("Uploaded — kicking off parser");
      // Reset form
      setTitle(""); setSyllabusCode(""); setPaperCode(""); setSyllabusYear("");
      if (fileRef.current) fileRef.current.value = "";

      await load();
      // Auto-parse
      if (row) await runParse(row.id);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const runParse = async (id: string) => {
    setParsingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("parse-syllabus", {
        body: { documentId: id },
      });
      if (error) throw error;
      toast.success(`Parsed — ${data?.topicCount ?? 0} topics extracted`);
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Parse failed");
      await load();
    } finally {
      setParsingId(null);
    }
  };

  const removeDoc = async (id: string, path: string) => {
    if (!confirm("Delete this syllabus and all its extracted topics?")) return;
    await supabase.storage.from("syllabi").remove([path]);
    await supabase.from("syllabus_documents").delete().eq("id", id);
    toast.success("Deleted");
    await load();
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Syllabus library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload MOE / SEAB / Cambridge syllabus PDFs. Codes like <code className="rounded bg-muted px-1">2260/01</code> are preserved verbatim.
          </p>
        </div>

        <Card className="mb-8 p-6">
          <h2 className="mb-4 text-lg font-medium">Upload a syllabus</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="title">Document title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sec Geography Paper 1 (2021)" />
            </div>
            <div>
              <Label htmlFor="sc">Syllabus code <span className="text-xs text-muted-foreground">(verbatim, e.g. 2260/01, 6091, 0001)</span></Label>
              <Input id="sc" value={syllabusCode} onChange={(e) => setSyllabusCode(e.target.value)} placeholder="2260/01" />
            </div>
            <div>
              <Label htmlFor="pc">Paper code (optional)</Label>
              <Input id="pc" value={paperCode} onChange={(e) => setPaperCode(e.target.value)} placeholder="01" />
            </div>
            <div>
              <Label>Exam board</Label>
              <Select value={examBoard} onValueChange={setExamBoard}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MOE">MOE</SelectItem>
                  <SelectItem value="SEAB">SEAB</SelectItem>
                  <SelectItem value="Cambridge">Cambridge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="yr">Syllabus year</Label>
              <Input id="yr" type="number" value={syllabusYear} onChange={(e) => setSyllabusYear(e.target.value)} placeholder="2021" />
            </div>
            <div>
              <Label>Subject (hint)</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Level (hint)</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="file">File (PDF, DOCX, TXT)</Label>
              <Input id="file" ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,application/pdf" />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={handleUpload} disabled={uploading} className="w-full sm:w-auto">
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload & parse
              </Button>
            </div>
          </div>
        </Card>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Library</h2>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : docs.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No syllabi uploaded yet. Upload your first one above.
          </Card>
        ) : (
          <div className="space-y-3">
            {docs.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{d.title}</span>
                      {d.syllabus_code && (
                        <Badge variant="secondary" className="font-mono">{d.syllabus_code}</Badge>
                      )}
                      <StatusBadge status={d.parse_status} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {d.subject && <span>{d.subject}</span>}
                      {d.level && <span>{d.level}</span>}
                      {d.exam_board && <span>{d.exam_board}</span>}
                      {d.syllabus_year && <span>{d.syllabus_year}</span>}
                      {d.paper_code && <span>Paper {d.paper_code}</span>}
                      {(paperCounts[d.id] ?? 0) > 1 && (
                        <span className="font-medium text-primary">{paperCounts[d.id]} papers</span>
                      )}
                    </div>
                    {d.parse_error && (
                      <p className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{d.parse_error}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/admin/syllabus/$id" params={{ id: d.id }}>
                        <Eye className="mr-2 h-4 w-4" />Review
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runParse(d.id)}
                      disabled={parsingId === d.id || d.parse_status === "parsing"}
                    >
                      {parsingId === d.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Re-parse
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeDoc(d.id, d.file_path)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
    parsing: { label: "Parsing…", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
    parsed: { label: "Parsed", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
    failed: { label: "Failed", cls: "bg-destructive/15 text-destructive" },
    published: { label: "Published", cls: "bg-primary/15 text-primary" },
  };
  const m = map[status] ?? map.pending;
  return <span className={`rounded-full px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>;
}
