import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, RefreshCw, Trash2, BookmarkPlus, Sparkles, ChevronUp, ChevronDown, X, Download } from "lucide-react";
import { BLOOMS } from "@/lib/syllabus";
import { toSectioned, sectionAtPosition, getSbqSkill } from "@/lib/sections";
import { exportAssessmentDocx } from "@/lib/export-docx";
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
  blueprint: unknown;
  instructions: string | null;
};

function EditorPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [fetching, setFetching] = useState(true);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [bulkRegenOpen, setBulkRegenOpen] = useState(false);
  const [bulkRegenInstr, setBulkRegenInstr] = useState("");
  const [bulkRegenDifficulty, setBulkRegenDifficulty] = useState<"keep" | "easy" | "medium" | "hard">("keep");
  const [bulkBusy, setBulkBusy] = useState(false);

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

  const toggleSelect = (qId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(questions.map((q) => q.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const updateQ = async (qId: string, patch: Partial<Question>) => {
    setQuestions((qs) => qs.map((q) => (q.id === qId ? { ...q, ...patch } : q)));
    await supabase.from("assessment_questions").update(patch).eq("id", qId);
  };

  const performDelete = async (ids: string[]) => {
    setQuestions((qs) => qs.filter((q) => !ids.includes(q.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((i) => next.delete(i));
      return next;
    });
    await supabase.from("assessment_questions").delete().in("id", ids);
    toast.success(ids.length === 1 ? "Question removed" : `${ids.length} questions removed`);
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

  const regenerate = async (
    qId: string,
    instruction: string,
    difficulty?: "easy" | "medium" | "hard",
  ) => {
    setRegenId(qId);
    const { data, error } = await supabase.functions.invoke("regenerate-question", {
      body: { questionId: qId, instruction, difficulty },
    });
    setRegenId(null);
    if (error) return toast.error("Regeneration failed");
    if (data?.question) {
      setQuestions((qs) => qs.map((q) => (q.id === qId ? { ...q, ...data.question } : q)));
      toast.success("Question regenerated");
    }
  };

  const bulkRegenerate = async (
    instruction: string,
    difficulty?: "easy" | "medium" | "hard",
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkRegenOpen(false);
    const toastId = toast.loading(`Regenerating 0 of ${ids.length}…`);
    let done = 0;
    let failed = 0;
    for (const qId of ids) {
      setRegenId(qId);
      try {
        const { data, error } = await supabase.functions.invoke("regenerate-question", {
          body: { questionId: qId, instruction, difficulty },
        });
        if (error) failed++;
        else if (data?.question) {
          setQuestions((qs) => qs.map((q) => (q.id === qId ? { ...q, ...data.question } : q)));
        }
      } catch {
        failed++;
      }
      done++;
      toast.loading(`Regenerating ${done} of ${ids.length}…`, { id: toastId });
    }
    setRegenId(null);
    setBulkBusy(false);
    setBulkRegenInstr("");
    setBulkRegenDifficulty("keep");
    if (failed > 0) {
      toast.error(`${done - failed} regenerated, ${failed} failed`, { id: toastId });
    } else {
      toast.success(`${done} questions regenerated`, { id: toastId });
    }
  };

  const saveQToBank = async (q: Question) => {
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
  };

  const saveToBank = async (q: Question) => {
    await saveQToBank(q);
    toast.success("Saved to question bank");
  };

  const bulkSaveToBank = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !user || !assessment) return;
    setBulkBusy(true);
    const toSave = questions.filter((q) => ids.includes(q.id));
    try {
      await supabase.from("question_bank_items").insert(
        toSave.map((q) => ({
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
        })),
      );
      toast.success(`${toSave.length} saved to question bank`);
      clearSelection();
    } catch {
      toast.error("Failed to save to bank");
    }
    setBulkBusy(false);
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

  const sectionedBlueprint = toSectioned(assessment.blueprint);

  // Blueprint compliance: marks per Bloom level
  const targetByBloom: Record<string, number> = {};
  sectionedBlueprint.sections.forEach((section) => {
    const bloom = section.bloom?.trim();
    if (!bloom) return;
    targetByBloom[bloom] = (targetByBloom[bloom] ?? 0) + section.marks;
  });
  const actualByBloom: Record<string, number> = {};
  questions.forEach((q) => {
    if (q.bloom_level) actualByBloom[q.bloom_level] = (actualByBloom[q.bloom_level] ?? 0) + q.marks;
  });
  const totalActual = questions.reduce((s, q) => s + q.marks, 0);
  const allSelected = questions.length > 0 && selectedIds.size === questions.length;

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
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={questions.length === 0}
              onClick={async () => {
                try {
                  await exportAssessmentDocx(
                    {
                      title: assessment.title,
                      subject: assessment.subject,
                      level: assessment.level,
                      total_marks: assessment.total_marks,
                      duration_minutes: assessment.duration_minutes,
                      instructions: assessment.instructions,
                      blueprint: assessment.blueprint,
                    },
                    questions.map((q) => ({
                      position: q.position,
                      question_type: q.question_type,
                      topic: q.topic,
                      bloom_level: q.bloom_level,
                      difficulty: q.difficulty,
                      marks: q.marks,
                      stem: q.stem,
                      options: q.options,
                      answer: q.answer,
                      mark_scheme: q.mark_scheme,
                    })),
                  );
                  toast.success("Downloaded .docx");
                } catch (e) {
                  toast.error("Export failed");
                  console.error(e);
                }
              }}
            >
              <Download className="h-4 w-4" /> Download .docx
            </Button>
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
            {selectedIds.size > 0 && (
              <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 shadow-sm backdrop-blur">
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
                <Button size="sm" variant="ghost" onClick={allSelected ? clearSelection : selectAll}>
                  {allSelected ? "Clear" : "Select all"}
                </Button>
                <div className="ml-auto flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkBusy}
                    onClick={() => setBulkRegenOpen(true)}
                    className="gap-1"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkBusy}
                    onClick={bulkSaveToBank}
                    className="gap-1"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" /> Save to bank
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkBusy}
                    onClick={() => setConfirmDelete({ ids: Array.from(selectedIds), label: `${selectedIds.size} questions` })}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection} className="gap-1">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {bulkRegenOpen && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="text-sm font-medium">Regenerate {selectedIds.size} questions</div>
                <Textarea
                  rows={2}
                  value={bulkRegenInstr}
                  onChange={(e) => setBulkRegenInstr(e.target.value)}
                  placeholder="Optional instruction applied to each: 'make harder', 'use Singapore context'…"
                  className="mt-2"
                />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={bulkBusy} onClick={() => bulkRegenerate(bulkRegenInstr)} className="gap-1">
                    {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Regenerate selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setBulkRegenOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {questions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
                <Sparkles className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {assessment.status === "generation_failed"
                    ? "Generation failed because no usable source-backed questions could be created for this topic."
                    : "No questions yet. Generation is still in progress."}
                </p>
              </div>
            ) : (
              questions.map((q, i) => {
                const sec = sectionAtPosition(sectionedBlueprint, i);
                const prevSec = i > 0 ? sectionAtPosition(sectionedBlueprint, i - 1) : null;
                const showHeader = sec && (i === 0 || sec.letter !== prevSec?.letter);
                const skillLabel = sec ? getSbqSkill(sec.sbq_skill)?.label : null;
                // For SBQ sections, the shared source pool A–E is identical on every
                // sub-question (see generator). Show it ONCE under the section header
                // and hide it on each individual question card to mirror SEAB layout.
                const isSbqSection = sec?.question_type === "source_based";
                const sectionSources = isSbqSection && q.source_excerpt
                  ? parseSharedSourcePool(q.source_excerpt)
                  : null;
                return (
                  <div key={q.id} className="space-y-3">
                    {showHeader && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-primary/30 bg-primary-soft/20 px-4 py-2">
                          <p className="text-sm font-semibold">
                            Section {sec.letter}
                            {skillLabel ? ` — Source-Based (${skillLabel})` : sec.name ? ` — ${sec.name}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {sec.num_questions} question{sec.num_questions === 1 ? "" : "s"} · {sec.marks} marks
                          </p>
                        </div>
                        {sectionSources && sectionSources.length > 0 && (
                          <div className="rounded-xl border border-border bg-card p-5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Sources for this section
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Refer to these sources when answering Section {sec.letter}.
                            </p>
                            <div className="mt-4 space-y-4">
                              {sectionSources.map((src: { label: string; text: string }) => (
                                <div
                                  key={src.label}
                                  className="rounded-lg border-l-4 border-primary bg-muted/40 p-4"
                                >
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                                    Source {src.label}
                                  </div>
                                  <p className="mt-2 font-paper text-sm italic leading-relaxed text-foreground whitespace-pre-wrap">
                                    {src.text}
                                  </p>
                                </div>
                              ))}
                              {q.source_url && (
                                <p className="text-xs text-muted-foreground">
                                  Primary citation:{" "}
                                  <a
                                    href={q.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="break-all font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                                  >
                                    {(() => { try { return new URL(q.source_url).hostname.replace(/^www\./, ""); } catch { return q.source_url; } })()}
                                    <span aria-hidden="true"> ↗</span>
                                  </a>
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <QuestionCard
                      q={q}
                      index={i + 1}
                      isLast={i === questions.length - 1}
                      isFirst={i === 0}
                      isRegen={regenId === q.id}
                      selected={selectedIds.has(q.id)}
                      onToggleSelect={() => toggleSelect(q.id)}
                      onUpdate={(patch) => updateQ(q.id, patch)}
                      onDelete={() => setConfirmDelete({ ids: [q.id], label: `Q${i + 1}` })}
                      onMove={(d) => moveQ(q.id, d)}
                      onRegenerate={(ins) => regenerate(q.id, ins)}
                      onBank={() => saveToBank(q)}
                      hideSourceBlock={isSbqSection}
                    />
                  </div>
                );
              })
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

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && confirmDelete.ids.length > 1
                ? `This will permanently delete ${confirmDelete.ids.length} questions from this assessment. This cannot be undone.`
                : "This will permanently delete the question from this assessment. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) performDelete(confirmDelete.ids);
                setConfirmDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Parse the generator's concatenated SBQ pool string ("Source A: …\n\nSource B: …")
 *  back into discrete labelled sources. Falls back to a single "A" entry when the
 *  excerpt does not match the multi-source pattern (e.g. legacy single-source rows). */
function parseSharedSourcePool(excerpt: string): Array<{ label: string; text: string }> {
  const matches = [...excerpt.matchAll(/Source\s+([A-E])\s*:\s*([\s\S]*?)(?=\n\s*Source\s+[A-E]\s*:|$)/g)];
  if (matches.length === 0) return [{ label: "A", text: excerpt.trim() }];
  return matches.map((m) => ({ label: m[1], text: m[2].trim() }));
}

function QuestionCard({
  q, index, isFirst, isLast, isRegen, selected, onToggleSelect, onUpdate, onDelete, onMove, onRegenerate, onBank, hideSourceBlock,
}: {
  q: Question; index: number; isFirst: boolean; isLast: boolean; isRegen: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onUpdate: (patch: Partial<Question>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onRegenerate: (instruction: string) => void;
  onBank: () => void;
  hideSourceBlock?: boolean;
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
    <div className={`rounded-xl border bg-card p-5 transition-colors ${selected ? "border-primary/60 ring-1 ring-primary/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select Q${index}`}
            className="mr-1"
          />
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
            {q.source_excerpt && !hideSourceBlock && (
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
                      className="break-all font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                    >
                      {(() => { try { return new URL(q.source_url).hostname.replace(/^www\./, ""); } catch { return q.source_url; } })()}
                      <span aria-hidden="true"> ↗</span>
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
