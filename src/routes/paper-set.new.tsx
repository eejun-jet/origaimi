import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";
import { Loader2, Layers, Upload, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/paper-set/new")({
  component: PaperSetNew,
  head: () => ({ meta: [{ title: "New paper set · origAImi" }] }),
});

type PaperRow = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  paper_number: string | null;
  year: number | null;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
};


type SyllabusDoc = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  syllabus_code: string | null;
};

function PaperSetNew() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Avoid SSR for this page: a browser extension rewrites Radix Select's
  // hidden <select> during hydration, which throws a hydration mismatch and
  // kills click handlers on the dropdowns.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [syllabusDocId, setSyllabusDocId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<SyllabusDoc[]>([]);
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("syllabus_documents")
        .select("id,title,subject,level,syllabus_code")
        .order("title");
      setDocs((data as SyllabusDoc[]) ?? []);
    })();
  }, []);

  const loadPapers = async () => {
    let q = supabase
      .from("past_papers")
      .select("id,title,subject,level,paper_number,year,parse_status,parse_error,created_at")
      .order("created_at", { ascending: false });
    if (subject) q = q.eq("subject", subject);
    if (level) q = q.eq("level", level);
    const { data } = await q;
    setPapers((data as PaperRow[]) ?? []);
  };

  useEffect(() => {
    loadPapers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, level]);

  // Poll while any selected/recent paper is still parsing.
  useEffect(() => {
    const anyPending = papers.some((p) => p.parse_status === "pending" || p.parse_status === "processing");
    if (!anyPending) return;
    const t = setInterval(loadPapers, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papers]);

  // Auto-pick syllabus doc when only one matches subject+level.
  const matchedDocs = useMemo(
    () => docs.filter((d) => (!subject || d.subject === subject) && (!level || d.level === level)),
    [docs, subject, level],
  );
  useEffect(() => {
    if (matchedDocs.length === 1) setSyllabusDocId(matchedDocs[0].id);
  }, [matchedDocs]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!subject || !level) {
      toast.error("Pick subject and level first — uploaded papers inherit those tags.");
      return;
    }
    const list = Array.from(files);
    const valid = list.filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith(".pdf") || n.endsWith(".docx");
    });
    if (valid.length === 0) {
      toast.error("Only PDF or .docx files are supported");
      return;
    }
    setUploading(true);
    const newIds: string[] = [];
    try {
      // 1. Upload all files to storage + insert past_papers rows fast.
      type Pending = { id: string; name: string };
      const pending: Pending[] = [];
      for (const file of valid) {
        const ext = file.name.split(".").pop() || "pdf";
        const baseTitle = file.name.replace(/\.(pdf|docx)$/i, "");
        const key = `${user?.id ?? "trial"}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("papers").upload(key, file, {
          contentType: file.type || (ext === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/pdf"),
          upsert: false,
        });
        if (up.error) {
          toast.error(`${file.name}: ${up.error.message}`);
          continue;
        }
        const { data: inserted, error: iErr } = await supabase
          .from("past_papers")
          .insert({
            user_id: user?.id ?? "00000000-0000-0000-0000-000000000001",
            title: baseTitle,
            subject,
            level,
            year: null,
            paper_number: null,
            exam_board: "MOE",
            file_path: key,
            parse_status: "pending",
          })
          .select("id")
          .single();
        if (iErr || !inserted) {
          toast.error(`${file.name}: ${iErr?.message ?? "insert failed"}`);
          continue;
        }
        const id = (inserted as { id: string }).id;
        newIds.push(id);
        pending.push({ id, name: file.name });
      }

      if (newIds.length > 0) {
        toast.success(
          `Uploaded ${newIds.length} paper${newIds.length > 1 ? "s" : ""} — parsing in background. The list updates as each one finishes.`,
        );
        setSelected((s) => {
          const n = new Set(s);
          newIds.forEach((id) => n.add(id));
          return n;
        });
        await loadPapers();
      }

      // 2. Fan-out parse-paper with bounded concurrency. We await each call so
      //    the connection stays open until the function returns 202; combined
      //    with EdgeRuntime.waitUntil on the server, the worker keeps running
      //    even after we move on, so disconnects no longer kill parses.
      const POOL = 3;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(POOL, pending.length) }, async () => {
        while (cursor < pending.length) {
          const idx = cursor++;
          const item = pending[idx];
          try {
            await supabase.functions.invoke("parse-paper", { body: { paperId: item.id } });
          } catch (err) {
            console.warn(`parse-paper kickoff failed for ${item.name}`, err);
          }
        }
      });
      await Promise.all(workers);
      await loadPapers();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const retryParse = async (paperId: string) => {
    await supabase
      .from("past_papers")
      .update({ parse_status: "pending", parse_error: null })
      .eq("id", paperId);
    await loadPapers();
    try {
      await supabase.functions.invoke("parse-paper", { body: { paperId } });
      toast.success("Re-parsing — this row will refresh in a moment.");
    } catch (err) {
      toast.error(`Could not start re-parse: ${String(err)}`);
    }
  };

  const deletePaper = async (paper: PaperRow) => {
    if (!confirm(`Delete "${paper.title}"? This removes the paper, its diagrams, and any bank items derived from it.`)) return;
    try {
      const { data: row } = await supabase.from("past_papers").select("file_path").eq("id", paper.id).single();
      const filePath = (row as { file_path: string } | null)?.file_path;
      await supabase.from("past_paper_diagrams").delete().eq("paper_id", paper.id);
      await supabase.from("question_bank_items").delete().eq("past_paper_id", paper.id);
      await supabase.from("paper_set_papers").delete().eq("paper_id", paper.id);
      const { error } = await supabase.from("past_papers").delete().eq("id", paper.id);
      if (error) { toast.error(`Delete failed: ${error.message}`); return; }
      if (filePath) await supabase.storage.from("papers").remove([filePath]).catch(() => {});
      setSelected((s) => { const n = new Set(s); n.delete(paper.id); return n; });
      toast.success("Paper deleted.");
      await loadPapers();
    } catch (e) {
      toast.error(`Delete failed: ${String(e)}`);
    }
  };


  const readySelected = papers.filter((p) => selected.has(p.id) && p.parse_status === "ready").length;
  const canSave = title.trim().length > 0 && subject && level && readySelected >= 2 && !saving;

  const save = async () => {
    if (!user) {
      toast.error("Please sign in.");
      return;
    }
    if (readySelected < 2) {
      toast.error("Pick at least two papers that have finished parsing.");
      return;
    }
    setSaving(true);
    const { data: setRow, error } = await supabase
      .from("paper_sets")
      .insert({
        user_id: user.id,
        title: title.trim(),
        subject,
        level,
        syllabus_doc_id: syllabusDocId || null,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();
    if (error || !setRow) {
      setSaving(false);
      toast.error(error?.message ?? "Could not create set");
      return;
    }
    const setId = (setRow as { id: string }).id;
    const orderedIds = papers
      .filter((p) => selected.has(p.id) && p.parse_status === "ready")
      .map((p) => p.id);
    const links = orderedIds.map((paper_id, position) => ({ set_id: setId, paper_id, position }));
    const { error: lErr } = await supabase.from("paper_set_papers").insert(links);
    if (lErr) {
      setSaving(false);
      toast.error(lErr.message);
      return;
    }
    toast.success("Paper set created");
    navigate({ to: "/paper-set/$id", params: { id: setId } });
  };

  // SSR-safe placeholder trigger so the page shell still renders before
  // hydration. The real Radix Select mounts client-side to avoid the
  // browser-extension hydration mismatch that breaks the dropdowns.
  const SelectPlaceholder = ({ label }: { label: string }) => (
    <button
      type="button"
      disabled
      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground"
    >
      {label}
    </button>
  );
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Review a paper set</h1>
            <p className="text-sm text-muted-foreground">
              Group several past papers — for example all four Combined Science papers — to see AO,
              KO and LO coverage across the entire set students will sit.
            </p>
          </div>
        </div>

        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div>
            <Label htmlFor="title">Set title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2025 Combined Science O-Level — full set"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Subject</Label>
              {mounted ? (
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger><SelectValue placeholder="Pick subject" /></SelectTrigger>
                  <SelectContent>
                    {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <SelectPlaceholder label="Pick subject" />}
            </div>
            <div>
              <Label>Level</Label>
              {mounted ? (
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger><SelectValue placeholder="Pick level" /></SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <SelectPlaceholder label="Pick level" />}
            </div>
            <div>
              <Label>Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger><SelectValue placeholder="Pick level" /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Syllabus document</Label>
            <Select value={syllabusDocId} onValueChange={setSyllabusDocId}>
              <SelectTrigger>
                <SelectValue placeholder={matchedDocs.length === 0 ? "No matching syllabus on file" : "Pick syllabus"} />
              </SelectTrigger>
              <SelectContent>
                {matchedDocs.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Used to load AO weightings and the full KO/LO list so the coverage view can flag gaps.
            </p>
          </div>
          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Cohort: 4N(A)" />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">Upload papers for this set</h2>
            <span className="text-xs text-muted-foreground">PDF or .docx · multi-select</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Drop the full set in here — e.g. all four Combined Science papers. Each paper is parsed
            in the background; once ready it's auto-selected for the set.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !subject || !level}
              className="gap-2"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload papers"}
            </Button>
            {(!subject || !level) && (
              <span className="text-xs text-muted-foreground">Pick subject and level above first.</span>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={loadPapers} className="ml-auto gap-1">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">Papers in this set</h2>
            <span className="text-sm text-muted-foreground">
              {readySelected} of {selected.size} selected ready
            </span>
          </div>
          {!subject || !level ? (
            <p className="text-sm text-muted-foreground">Pick a subject and level above to see your parsed papers.</p>
          ) : papers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No papers found for {subject} · {level}. Upload above, or <Link to="/papers" className="text-primary underline">manage papers</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {papers.map((p) => {
                const ready = p.parse_status === "ready";
                const failed = p.parse_status === "failed";
                const ageMs = Date.now() - new Date(p.created_at).getTime();
                const stuck = !ready && !failed && ageMs > 5 * 60 * 1000;
                const canRetry = failed || stuck;
                return (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggle(p.id)}
                      disabled={!ready}
                      id={`pp-${p.id}`}
                    />
                    <label htmlFor={`pp-${p.id}`} className={`flex-1 ${ready ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
                      <div className="text-sm font-medium">{p.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {[p.year, p.paper_number ? `Paper ${p.paper_number}` : null].filter(Boolean).join(" · ") || "—"}
                        {failed && p.parse_error ? <span className="ml-2 text-destructive">· {p.parse_error.slice(0, 140)}</span> : null}
                        {stuck ? <span className="ml-2 text-amber-600">· stuck for {Math.round(ageMs / 60000)} min</span> : null}
                      </div>
                    </label>
                    <Badge variant={ready ? "secondary" : failed ? "destructive" : "outline"}>
                      {ready ? "ready" : failed ? "failed" : "parsing…"}
                    </Badge>
                    {ready ? (
                      <Button
                        type="button" size="sm" variant="ghost"
                        onClick={() => supabase.functions.invoke("render-paper-figures", { body: { paperId: p.id } })}
                        className="gap-1"
                        title="Re-render any diagrams still pointing at the source PDF"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Diagrams
                      </Button>
                    ) : null}
                    {canRetry ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => retryParse(p.id)} className="gap-1">
                        <RefreshCw className="h-3.5 w-3.5" /> Retry
                      </Button>
                    ) : null}
                    <Button
                      type="button" size="sm" variant="ghost"
                      onClick={() => deletePaper(p)}
                      className="gap-1 text-destructive hover:text-destructive"
                      title="Delete this paper"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create set & view coverage
          </Button>
        </div>
      </main>
    </div>
  );
}
