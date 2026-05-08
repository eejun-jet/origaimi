import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlainSelect } from "@/components/PlainSelect";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";
import { Loader2, Sparkles, Lightbulb, FileUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/authentic/new")({
  component: NewAuthenticPlan,
  head: () => ({ meta: [{ title: "New authentic assessment plan · origAImi" }] }),
});

type SyllabusDoc = { id: string; title: string; subject: string | null; level: string | null; syllabus_code: string | null };

const MIX_OPTIONS = [
  "balanced",
  "more authentic / real-world",
  "more formative / mini-tests",
  "include a long project",
  "include presentation / oral",
  "no group work",
  "must include use of digital tools",
] as const;

function NewAuthenticPlan() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [syllabusDocId, setSyllabusDocId] = useState<string>("");
  const [docs, setDocs] = useState<SyllabusDoc[]>([]);
  const [unitFocus, setUnitFocus] = useState("");
  const [sowText, setSowText] = useState("");
  const [durationWeeks, setDurationWeeks] = useState<number>(4);
  const [classSize, setClassSize] = useState<number>(35);
  const [goals, setGoals] = useState("");
  const [constraints, setConstraints] = useState("");
  const [mix, setMix] = useState<string[]>(["balanced"]);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [sowFileName, setSowFileName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("syllabus_documents")
        .select("id,title,subject,level,syllabus_code")
        .order("title");
      setDocs((data as SyllabusDoc[]) ?? []);
    })();
  }, []);

  const filteredDocs = docs.filter((d) =>
    (!subject || d.subject === subject) && (!level || d.level === level));

  const toggleMix = (v: string) =>
    setMix((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);

  const submit = async () => {
    if (!title.trim()) { toast.error("Give the unit a title."); return; }
    if (!sowText.trim() && !unitFocus.trim()) {
      toast.error("Paste your scheme of work, or at least describe the unit focus.");
      return;
    }
    setSaving(true);
    const { data: plan, error } = await supabase
      .from("authentic_plans")
      .insert({
        user_id: user?.id ?? null,
        title: title.trim(),
        subject: subject || null,
        level: level || null,
        syllabus_doc_id: syllabusDocId || null,
        sow_text: sowText.trim() || null,
        unit_focus: unitFocus.trim() || null,
        duration_weeks: durationWeeks || null,
        class_size: classSize || null,
        goals: goals.trim() || null,
        constraints: constraints.trim() || null,
        mix_preferences: mix,
        status: "generating",
      })
      .select("id")
      .single();
    if (error || !plan) {
      setSaving(false);
      toast.error(`Save failed: ${error?.message ?? "unknown"}`);
      return;
    }

    // Fire generation; the detail page also kicks off as a fallback.
    supabase.functions.invoke("generate-authentic-ideas", { body: { plan_id: plan.id } })
      .catch((e) => console.error("generate-authentic-ideas invoke:", e));

    navigate({ to: "/authentic/$id", params: { id: plan.id } });
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-paper text-2xl font-semibold tracking-tight">New authentic assessment plan</h1>
            <p className="text-sm text-muted-foreground">
              Upload (or paste) your scheme of work. origAImi will suggest a balanced portfolio:
              mini-tests, performance tasks, projects, oral, written-authentic, self/peer.
            </p>
          </div>
        </div>

        <div className="space-y-6 rounded-xl border border-border bg-card p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Unit / plan title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sec 3 Chemistry — Acids, Bases & Salts" />
            </div>
            <div>
              <Label>Subject</Label>
              <PlainSelect value={subject} onValueChange={setSubject} options={[{ value: "", label: "Any subject" }, ...SUBJECTS.map((s) => ({ value: s, label: s }))]} />
            </div>
            <div>
              <Label>Level</Label>
              <PlainSelect value={level} onValueChange={setLevel} options={[{ value: "", label: "Any level" }, ...LEVELS.map((l) => ({ value: l, label: l }))]} />
            </div>
            <div>
              <Label>Syllabus (optional but recommended)</Label>
              <PlainSelect
                value={syllabusDocId}
                onValueChange={setSyllabusDocId}
                options={[{ value: "", label: "No syllabus context" }, ...filteredDocs.map((d) => ({ value: d.id, label: `${d.syllabus_code ?? ""} ${d.title}`.trim() }))]}
              />
            </div>
          </div>

          <div>
            <Label>What is this unit about? (1–3 lines)</Label>
            <Textarea value={unitFocus} onChange={(e) => setUnitFocus(e.target.value)} rows={2}
              placeholder="e.g. Reactions of acids and bases; pH; salt preparation; everyday applications." />
          </div>

          <div>
            <Label>Scheme of work</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id="sow-file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const lower = f.name.toLowerCase();
                  if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
                    toast.error("Only PDF or .docx supported");
                    return;
                  }
                  if (f.size > 15 * 1024 * 1024) {
                    toast.error("File too large (max 15 MB)");
                    return;
                  }
                  setExtracting(true);
                  try {
                    const buf = await f.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let bin = "";
                    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                    const b64 = btoa(bin);
                    const { data, error } = await supabase.functions.invoke("extract-sow-text", {
                      body: { file_base64: b64, mime_type: f.type, filename: f.name },
                    });
                    if (error) throw error;
                    const text = (data as { text?: string } | null)?.text ?? "";
                    if (!text.trim()) { toast.error("Could not read text from that file."); return; }
                    setSowText((prev) => prev ? `${prev}\n\n${text}` : text);
                    setSowFileName(f.name);
                    toast.success(`Loaded ${f.name}`);
                  } catch (err) {
                    toast.error(`Upload failed: ${err instanceof Error ? err.message : "unknown"}`);
                  } finally {
                    setExtracting(false);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={extracting}
                onClick={() => document.getElementById("sow-file")?.click()}
                className="gap-2"
              >
                {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                {extracting ? "Reading file…" : "Upload PDF or .docx"}
              </Button>
              {sowFileName && <span className="text-xs text-muted-foreground">Loaded: {sowFileName}</span>}
            </div>
            <Textarea
              className="mt-2"
              value={sowText}
              onChange={(e) => setSowText(e.target.value)}
              rows={8}
              placeholder="…or paste your weekly SoW here — lessons, key concepts, planned activities, materials. The richer this is, the better the ideas."
            />
            <p className="mt-1 text-xs text-muted-foreground">Upload a PDF/.docx and we'll extract the text into the box below — you can edit it before generating.</p>
          </div>


          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Duration (weeks)</Label>
              <Input type="number" min={1} max={20} value={durationWeeks} onChange={(e) => setDurationWeeks(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Class size</Label>
              <Input type="number" min={1} max={60} value={classSize} onChange={(e) => setClassSize(Number(e.target.value) || 0)} />
            </div>
          </div>

          <div>
            <Label>Portfolio mix preferences</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {MIX_OPTIONS.map((m) => {
                const active = mix.includes(m);
                return (
                  <button key={m} type="button" onClick={() => toggleMix(m)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"}`}>
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Teacher goals (optional)</Label>
              <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={3}
                placeholder="What do you most want students to come away with?" />
            </div>
            <div>
              <Label>Constraints (optional)</Label>
              <Textarea value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={3}
                placeholder="e.g. no out-of-school trips; must include ICT; one practical lesson only." />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <Link to="/dashboard"><Button variant="ghost">Cancel</Button></Link>
            <Button onClick={submit} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate ideas
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
