import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";
import { Loader2, Upload, FileText, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/papers")({
  component: PapersPage,
  head: () => ({ meta: [{ title: "Past papers · origAImi" }] }),
});

type PaperRow = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  year: number | null;
  paper_number: string | null;
  exam_board: string | null;
  parse_status: string;
  parse_error: string | null;
  page_count: number | null;
  topics: string[] | null;
  questions_json: unknown;
  style_summary: string | null;
  created_at: string;
};

type DiagramCount = { paper_id: string; count: number };

function PapersPage() {
  const { user } = useAuth();
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [diagCounts, setDiagCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("past_papers")
      .select("*")
      .order("created_at", { ascending: false });
    setPapers((data as PaperRow[]) ?? []);
    const ids = ((data as PaperRow[]) ?? []).map((p) => p.id);
    if (ids.length > 0) {
      const { data: diag } = await supabase
        .from("past_paper_diagrams")
        .select("paper_id")
        .in("paper_id", ids);
      const counts: Record<string, number> = {};
      ((diag as { paper_id: string }[]) ?? []).forEach((d) => {
        counts[d.paper_id] = (counts[d.paper_id] ?? 0) + 1;
      });
      setDiagCounts(counts);
    } else {
      setDiagCounts({});
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = papers.filter((p) => {
    if (filterSubject !== "all" && p.subject !== filterSubject) return false;
    if (filterLevel !== "all" && p.level !== filterLevel) return false;
    if (search.trim() && !`${p.title} ${(p.topics ?? []).join(" ")}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-paper text-2xl font-semibold tracking-tight">Past papers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload tagged past papers. The generator will reuse their figures and match their style when drafting new assessments.
            </p>
          </div>
        </div>

        <UploadForm userId={user?.id} onUploaded={load} />

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <Select value={filterSubject} onValueChange={setFilterSubject}>
              <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Level</Label>
            <Select value={filterLevel} onValueChange={setFilterLevel}>
              <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Search title or topic…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 max-w-xs"
          />
          <Button variant="ghost" size="sm" onClick={load} className="ml-auto gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading papers…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                {papers.length === 0
                  ? "No past papers uploaded yet. Upload your first one above."
                  : "No papers match those filters."}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((p) => (
                <PaperCard
                  key={p.id}
                  paper={p}
                  diagramCount={diagCounts[p.id] ?? 0}
                  onChanged={load}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function UploadForm({ userId, onUploaded }: { userId?: string; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [level, setLevel] = useState<string>("Sec 4");
  const [year, setYear] = useState<string>(String(new Date().getFullYear() - 1));
  const [paperNumber, setPaperNumber] = useState<string>("1");
  const [examBoard, setExamBoard] = useState<string>("MOE");
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return toast.error("Pick a PDF file first");
    if (!title.trim()) return toast.error("Give the paper a title");
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const key = `${userId ?? "trial"}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("papers").upload(key, file, {
        contentType: file.type || "application/pdf",
        upsert: false,
      });
      if (up.error) throw new Error(up.error.message);

      const { data: inserted, error: iErr } = await supabase
        .from("past_papers")
        .insert({
          user_id: userId ?? "00000000-0000-0000-0000-000000000001",
          title,
          subject,
          level,
          year: Number(year) || null,
          paper_number: paperNumber || null,
          exam_board: examBoard,
          file_path: key,
          parse_status: "pending",
        })
        .select()
        .single();
      if (iErr || !inserted) throw new Error(iErr?.message ?? "insert failed");

      // Kick off background parsing.
      supabase.functions.invoke("parse-paper", { body: { paperId: (inserted as { id: string }).id } })
        .catch((err) => console.warn("parse-paper invocation error", err));

      toast.success("Uploaded — parsing in the background");
      setTitle(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-paper text-lg font-semibold">Upload past paper</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        PDF. We'll extract figures and topic tags so the generator can reuse them.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 2023 O-Level Physics 6091 Paper 2" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Subject</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Level</Label>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Year</Label>
          <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Paper number</Label>
          <Input value={paperNumber} onChange={(e) => setPaperNumber(e.target.value)} placeholder="1" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Exam board</Label>
          <Input value={examBoard} onChange={(e) => setExamBoard(e.target.value)} placeholder="MOE" />
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label className="text-xs">PDF file</Label>
          <Input ref={fileRef} type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={busy} className="gap-1">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "Uploading…" : "Upload paper"}
        </Button>
      </div>
    </form>
  );
}

function PaperCard({
  paper, diagramCount, onChanged,
}: {
  paper: PaperRow; diagramCount: number; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!confirm(`Delete "${paper.title}"? This will also remove its extracted bank items.`)) return;
    setBusy(true);
    // Cascade: remove bank items, diagrams, then the paper itself.
    await supabase.from("question_bank_items").delete().eq("past_paper_id", paper.id);
    await supabase.from("past_paper_diagrams").delete().eq("paper_id", paper.id);
    await supabase.from("past_papers").delete().eq("id", paper.id);
    toast.success("Paper and bank items deleted");
    onChanged();
  };
  const reparse = async () => {
    setBusy(true);
    try {
      await supabase.from("past_papers").update({ parse_status: "pending", parse_error: null }).eq("id", paper.id);
      await supabase.functions.invoke("parse-paper", { body: { paperId: paper.id } });
      toast.success("Re-parsing started");
      onChanged();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const statusColor =
    paper.parse_status === "ready" ? "bg-success/15 text-success" :
    paper.parse_status === "failed" ? "bg-destructive/15 text-destructive" :
    "bg-muted text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium leading-tight">{paper.title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusColor}`}>
          {paper.parse_status}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {paper.subject && <Badge variant="secondary">{paper.subject}</Badge>}
        {paper.level && <Badge variant="secondary">{paper.level}</Badge>}
        {paper.year && <Badge variant="secondary">{paper.year}</Badge>}
        {paper.paper_number && <Badge variant="secondary">P{paper.paper_number}</Badge>}
        {paper.exam_board && <Badge variant="outline">{paper.exam_board}</Badge>}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {paper.parse_status === "ready" ? (
          <>
            {paper.page_count ?? "?"} pages · <span className="text-foreground">{diagramCount} diagrams indexed</span>
            {Array.isArray(paper.questions_json) && (paper.questions_json as unknown[]).length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                ✓ exemplar-ready ({(paper.questions_json as unknown[]).length} Qs)
              </span>
            )}
          </>
        ) : paper.parse_status === "failed" ? (
          <span className="text-destructive">{paper.parse_error ?? "Parse failed"}</span>
        ) : (
          <>Parsing… check back in a moment</>
        )}
      </div>
      {paper.topics && paper.topics.length > 0 && (
        <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          Topics: {paper.topics.slice(0, 6).join(", ")}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="ghost" onClick={reparse} disabled={busy} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" /> Re-parse
        </Button>
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy} className="ml-auto gap-1 text-destructive">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}
