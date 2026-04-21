import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, RefreshCw, Trash2, BookmarkPlus, Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { BLOOMS } from "@/lib/syllabus";
import { toast } from "sonner";

export const Route = createFileRoute("/assessment/$id")({
  component: EditorPage,
});

type Question = {
  id: string;
  position: number;
  question_type: string;
  topic: string | null;
  bloom_level: string | null;
  difficulty: string | null;
  marks: number;
  stem: string;
  options: string[] | null;
  answer: string | null;
  mark_scheme: string | null;
  source_excerpt: string | null;
  source_url: string | null;
  notes: string | null;
  diagram_url: string | null;
  diagram_source: string | null;
  diagram_citation: string | null;
  diagram_caption: string | null;
};

type Assessment = {
  id: string;
  title: string;
  subject: string;
  level: string;
  total_marks: number;
  duration_minutes: number;
  status: string;
  blueprint: { topic: string; bloom: string; marks: number }[];
};

function EditorPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [fetching, setFetching] = useState(true);
  const [regenId, setRegenId] = useState<string | null>(null);

  const loadAll = async () => {
    const { data: a } = await supabase.from("assessments").select("*").eq("id", id).single();
    setAssessment(a as Assessment | null);
    const { data: q } = await supabase.from("assessment_questions").select("*").eq("assessment_id", id).order("position");
    setQuestions((q as Question[]) ?? []);
    setFetching(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const updateQ = async (qId: string, patch: Partial<Question>) => {
    setQuestions((qs) => qs.map((q) => (q.id === qId ? { ...q, ...patch } : q)));
    await supabase.from("assessment_questions").update(patch).eq("id", qId);
  };

  const deleteQ = async (qId: string) => {
    setQuestions((qs) => qs.filter((q) => q.id !== qId));
    await supabase.from("assessment_questions").delete().eq("id", qId);
    toast.success("Question removed");
  };

  const moveQ = async (qId: string, dir: -1 | 1) => {
    const idx = questions.findIndex((q) => q.id === qId);
    const swap = idx + dir;
    if (swap < 0 || swap >= questions.length) return;
    const a = questions[idx];
    const b = questions[swap];
    const newQs = [...questions];
    newQs[idx] = { ...b, position: a.position };
    newQs[swap] = { ...a, position: b.position };
    setQuestions(newQs);
    await Promise.all([
      supabase.from("assessment_questions").update({ position: b.position }).eq("id", a.id),
      supabase.from("assessment_questions").update({ position: a.position }).eq("id", b.id),
    ]);
  };

  const regenerate = async (qId: string, instruction: string) => {
    setRegenId(qId);
    const { data, error } = await supabase.functions.invoke("regenerate-question", {
      body: { questionId: qId, instruction },
    });
    setRegenId(null);
    if (error) return toast.error("Regeneration failed");
    if (data?.question) {
      setQuestions((qs) => qs.map((q) => (q.id === qId ? { ...q, ...data.question } : q)));
      toast.success("Question regenerated");
    }
  };

  const saveToBank = async (q: Question) => {
    if (!user || !assessment) return;
    await supabase.from("question_bank_items").insert({
      user_id: user.id,
      subject: assessment.subject,
      level: assessment.level,
      topic: q.topic,
      bloom_level: q.bloom_level,
      difficulty: q.difficulty,
      question_type: q.question_type,
      marks: q.marks,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      mark_scheme: q.mark_scheme,
      source: "ai",
    });
    toast.success("Saved to question bank");
  };

  const setStatus = async (status: string) => {
    if (!assessment) return;
    await supabase.from("assessments").update({ status }).eq("id", assessment.id);
    setAssessment({ ...assessment, status });
    toast.success(`Marked as ${status.replace("_", " ")}`);
  };

  if (fetching) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto max-w-7xl px-4 py-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading assessment...
          </div>
        </div>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto max-w-3xl px-4 py-12 text-center">
          <h2 className="font-paper text-2xl font-semibold">Assessment not found</h2>
          <Link to="/dashboard" className="mt-4 inline-block text-primary underline">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // Blueprint compliance: marks per Bloom level
  const targetByBloom: Record<string, number> = {};
  assessment.blueprint?.forEach((b) => {
    targetByBloom[b.bloom] = (targetByBloom[b.bloom] ?? 0) + b.marks;
  });
  const actualByBloom: Record<string, number> = {};
  questions.forEach((q) => {
    if (q.bloom_level) actualByBloom[q.bloom_level] = (actualByBloom[q.bloom_level] ?? 0) + q.marks;
  });
  const totalActual = questions.reduce((s, q) => s + q.marks, 0);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-paper text-2xl font-semibold tracking-tight sm:text-3xl">{assessment.title}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{assessment.subject}</Badge>
              <Badge variant="secondary">{assessment.level}</Badge>
              <Badge variant="secondary">{assessment.duration_minutes} min</Badge>
              <Badge variant="secondary">{totalActual} / {assessment.total_marks} marks</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Select value={assessment.status} onValueChange={setStatus}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in_review">In review</SelectItem>
                <SelectItem value="finalised">Finalised</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {questions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
                <Sparkles className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No questions yet. Generation may still be in progress, or it failed silently.
                </p>
              </div>
            ) : (
              questions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  index={i + 1}
                  isLast={i === questions.length - 1}
                  isFirst={i === 0}
                  isRegen={regenId === q.id}
                  onUpdate={(patch) => updateQ(q.id, patch)}
                  onDelete={() => deleteQ(q.id)}
                  onMove={(d) => moveQ(q.id, d)}
                  onRegenerate={(ins) => regenerate(q.id, ins)}
                  onBank={() => saveToBank(q)}
                />
              ))
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-medium">TOS Alignment Meter</h3>
              <p className="mt-1 text-xs text-muted-foreground">Marks per Bloom's level</p>
              <div className="mt-3 space-y-2">
                {BLOOMS.filter((b) => targetByBloom[b]).map((b) => {
                  const target = targetByBloom[b] ?? 0;
                  const actual = actualByBloom[b] ?? 0;
                  const pct = target ? Math.min(100, (actual / target) * 100) : 0;
                  const ok = actual === target;
                  return (
                    <div key={b}>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{b}</span>
                        <span className={ok ? "text-success" : "text-foreground"}>{actual} / {target} {ok && "✓"}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full transition-all ${ok ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {Object.keys(targetByBloom).length === 0 && (
                  <p className="text-xs text-muted-foreground">No TOS set.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Assessment Coach</h3>
                <span className="rounded-full bg-warm px-2 py-0.5 text-[10px] uppercase tracking-wide text-warm-foreground">
                  Coming soon
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Your embedded Assessment Literacy Coach will evaluate this paper against
                AO frameworks and surface actionable insights.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-medium">Total marks</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className={`font-paper text-3xl font-semibold ${totalActual === assessment.total_marks ? "text-success" : "text-foreground"}`}>{totalActual}</span>
                <span className="text-sm text-muted-foreground">/ {assessment.total_marks}</span>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function QuestionCard({
  q, index, isFirst, isLast, isRegen, onUpdate, onDelete, onMove, onRegenerate, onBank,
}: {
  q: Question; index: number; isFirst: boolean; isLast: boolean; isRegen: boolean;
  onUpdate: (patch: Partial<Question>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onRegenerate: (instruction: string) => void;
  onBank: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [stem, setStem] = useState(q.stem);
  const [answer, setAnswer] = useState(q.answer ?? "");
  const [scheme, setScheme] = useState(q.mark_scheme ?? "");
  const [marks, setMarks] = useState(q.marks);
  const [bloom, setBloom] = useState(q.bloom_level ?? "");
  const [showRegen, setShowRegen] = useState(false);
  const [regenInstr, setRegenInstr] = useState("");

  const save = () => {
    onUpdate({ stem, answer, mark_scheme: scheme, marks, bloom_level: bloom || null });
    setEditing(false);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-paper text-lg font-semibold text-foreground">Q{index}</span>
          <Badge variant="outline">{q.question_type.replace("_", " ")}</Badge>
          {q.topic && <Badge variant="outline">{q.topic}</Badge>}
          {q.bloom_level && <Badge variant="secondary">{q.bloom_level}</Badge>}
          <Badge variant="secondary">[{q.marks}]</Badge>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" disabled={isFirst} onClick={() => onMove(-1)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" disabled={isLast} onClick={() => onMove(1)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {editing ? (
          <div className="space-y-3">
            <Textarea rows={4} value={stem} onChange={(e) => setStem(e.target.value)} className="font-paper" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Marks</label>
                <Input type="number" min={1} value={marks} onChange={(e) => setMarks(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Bloom's</label>
                <Select value={bloom} onValueChange={setBloom}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {BLOOMS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Answer</label>
              <Textarea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Mark scheme</label>
              <Textarea rows={3} value={scheme} onChange={(e) => setScheme(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            {q.source_excerpt && (
              <div className="mb-4 rounded-lg border-l-4 border-primary bg-muted/40 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Source A</div>
                <p className="mt-2 font-paper text-sm italic leading-relaxed text-foreground whitespace-pre-wrap">
                  {q.source_excerpt}
                </p>
                {q.source_url && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Source:{" "}
                    <a
                      href={q.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-primary underline hover:text-primary/80"
                    >
                      {(() => { try { return new URL(q.source_url).hostname.replace(/^www\./, ""); } catch { return q.source_url; } })()}
                    </a>
                  </p>
                )}
              </div>
            )}
            {q.notes && q.question_type === "source_based" && !q.source_excerpt && (
              <div className="mb-4 rounded-lg border border-warm bg-warm/20 p-3 text-xs text-warm-foreground">
                ⚠ {q.notes}
              </div>
            )}
            <p className="font-paper text-base leading-relaxed text-foreground whitespace-pre-wrap">{q.stem}</p>
            {q.diagram_url && (
              <figure className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
                <img
                  src={q.diagram_url}
                  alt={q.diagram_caption ?? "Question diagram"}
                  className="mx-auto max-h-[420px] w-auto bg-white object-contain p-2"
                />
                <figcaption className="border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Figure {index}</span>
                  {q.diagram_caption ? <> — {q.diagram_caption}</> : null}
                  {q.diagram_citation && (
                    <div className="mt-0.5 break-all">Source: {q.diagram_citation}</div>
                  )}
                  {q.diagram_source === "ai_generated" && (
                    <div className="mt-0.5 italic">AI-generated exam-style diagram</div>
                  )}
                </figcaption>
              </figure>
            )}
            {q.options && Array.isArray(q.options) && q.options.length > 0 && (
              <ol className="mt-3 list-inside list-[upper-alpha] space-y-1 font-paper text-sm">
                {q.options.map((o, i) => <li key={i}>{o}</li>)}
              </ol>
            )}
            {(q.answer || q.mark_scheme) && (
              <details className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">Mark scheme</summary>
                {q.answer && <p className="mt-2"><span className="font-medium">Answer:</span> {q.answer}</p>}
                {q.mark_scheme && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{q.mark_scheme}</p>}
              </details>
            )}
          </>
        )}
      </div>

      {showRegen && !editing && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
          <Textarea rows={2} value={regenInstr} onChange={(e) => setRegenInstr(e.target.value)}
            placeholder="Optional: 'make harder', 'use Singapore hawker context', 'less wordy'..." />
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={isRegen} onClick={() => onRegenerate(regenInstr)} className="gap-1">
              {isRegen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Regenerate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowRegen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="mt-4 flex flex-wrap gap-1 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowRegen(true)} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
          </Button>
          <Button size="sm" variant="ghost" onClick={onBank} className="gap-1">
            <BookmarkPlus className="h-3.5 w-3.5" /> Save to bank
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} className="ml-auto gap-1 text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      )}
    </div>
  );
}
