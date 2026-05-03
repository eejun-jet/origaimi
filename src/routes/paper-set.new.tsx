import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { Loader2, Layers } from "lucide-react";
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

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [syllabusDocId, setSyllabusDocId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<SyllabusDoc[]>([]);
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("syllabus_documents")
        .select("id,title,subject,level,syllabus_code")
        .order("title");
      setDocs((data as SyllabusDoc[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("past_papers")
        .select("id,title,subject,level,paper_number,year,parse_status")
        .eq("parse_status", "ready")
        .order("created_at", { ascending: false });
      if (subject) q = q.eq("subject", subject);
      if (level) q = q.eq("level", level);
      const { data } = await q;
      setPapers((data as PaperRow[]) ?? []);
    })();
  }, [subject, level]);

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

  const canSave = title.trim().length > 0 && subject && level && selected.size >= 2 && !saving;

  const save = async () => {
    if (!user) {
      toast.error("Please sign in.");
      return;
    }
    if (selected.size < 2) {
      toast.error("Pick at least two papers — a single paper already has its own coverage view.");
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
    const orderedIds = Array.from(selected);
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
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger><SelectValue placeholder="Pick subject" /></SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
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
            <h2 className="text-lg font-medium">Papers in this set</h2>
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          </div>
          {!subject || !level ? (
            <p className="text-sm text-muted-foreground">Pick a subject and level above to see your parsed papers.</p>
          ) : papers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No parsed papers found for {subject} · {level}. <Link to="/papers" className="text-primary underline">Upload papers</Link> first.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {papers.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                    id={`pp-${p.id}`}
                  />
                  <label htmlFor={`pp-${p.id}`} className="flex-1 cursor-pointer">
                    <div className="text-sm font-medium">{p.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {[p.year, p.paper_number ? `Paper ${p.paper_number}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </label>
                  <Badge variant="secondary">ready</Badge>
                </li>
              ))}
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
