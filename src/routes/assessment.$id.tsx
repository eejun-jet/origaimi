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
import { ArrowLeft, Loader2, RefreshCw, Trash2, BookmarkPlus, Sparkles, ChevronUp, ChevronDown, X, Download, Image as ImageIcon, Wand2, MessageCircle, UserPlus } from "lucide-react";
import { BLOOMS } from "@/lib/syllabus";
import { toSectioned, sectionAtPosition, getSbqSkill, KNOWLEDGE_OUTCOMES, type Section } from "@/lib/sections";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronRight } from "lucide-react";
import { exportAssessmentDocx } from "@/lib/export-docx";
import { CommentThread } from "@/components/CommentThread";
import { CommentDock } from "@/components/CommentDock";
import { InviteReviewerDialog } from "@/components/InviteReviewerDialog";
import {
  type AssessmentComment,
  type CommentScope,
  type CommentStatus,
  type ReviewerIdentity,
  useReviewerIdentity,
} from "@/lib/comments";
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
  ao_codes: string[];
  knowledge_outcomes: string[];
  learning_outcomes: string[];
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
  syllabus_doc_id: string | null;
};

type AODef = { code: string; title: string | null; weighting_percent: number | null };

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
  const [aoDefs, setAoDefs] = useState<AODef[]>([]);
  const [comments, setComments] = useState<AssessmentComment[]>([]);
  const [identity, setIdentity] = useReviewerIdentity();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"coverage" | "comments">("coverage");

  const loadAll = async () => {
    const { data: a } = await supabase.from("assessments").select("*").eq("id", id).single();
    const asm = a as Assessment | null;
    setAssessment(asm);
    const { data: q } = await supabase.from("assessment_questions").select("*").eq("assessment_id", id).order("position");
    setQuestions((q as Question[]) ?? []);
    if (asm?.syllabus_doc_id) {
      const { data: aos } = await supabase
        .from("syllabus_assessment_objectives")
        .select("code,title,weighting_percent")
        .eq("source_doc_id", asm.syllabus_doc_id)
        .order("position");
      setAoDefs((aos as AODef[]) ?? []);
    } else {
      setAoDefs([]);
    }
    const { data: cs } = await supabase
      .from("assessment_comments")
      .select("*")
      .eq("assessment_id", id)
      .order("created_at", { ascending: true });
    setComments((cs as AssessmentComment[]) ?? []);
    setFetching(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Realtime: keep comments in sync across collaborators
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assessment_comments", filter: `assessment_id=eq.${id}` },
        (payload) => {
          setComments((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as AssessmentComment;
              if (prev.some((c) => c.id === next.id)) return prev;
              return [...prev, next].sort((a, b) => a.created_at.localeCompare(b.created_at));
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as AssessmentComment;
              return prev.map((c) => (c.id === next.id ? next : c));
            }
            if (payload.eventType === "DELETE") {
              const oldRow = payload.old as { id: string };
              return prev.filter((c) => c.id !== oldRow.id);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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

  // ─── Comments handlers ───────────────────────────────────────────────
  const addComment = async (input: {
    body: string;
    scope: CommentScope;
    parentId: string | null;
    sectionLetter: string | null;
    questionId: string | null;
  }) => {
    const { error } = await supabase.from("assessment_comments").insert({
      assessment_id: id,
      scope: input.scope,
      section_letter: input.sectionLetter,
      question_id: input.questionId,
      parent_id: input.parentId,
      author_name: identity.name,
      author_email: identity.email,
      author_role: identity.role,
      body: input.body,
      status: "open",
    });
    if (error) toast.error("Could not post comment");
  };

  const setCommentStatus = async (commentId: string, status: CommentStatus) => {
    const patch = status === "resolved"
      ? { status, resolved_by: identity.name, resolved_at: new Date().toISOString() }
      : { status, resolved_by: null, resolved_at: null };
    const { error } = await supabase.from("assessment_comments").update(patch).eq("id", commentId);
    if (error) toast.error("Could not update comment");
  };

  const deleteComment = async (commentId: string) => {
    const { error } = await supabase.from("assessment_comments").delete().eq("id", commentId);
    if (error) toast.error("Could not delete comment");
  };

  const scrollToQuestion = (questionId: string) => {
    const el = document.getElementById(`q-${questionId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const scrollToSection = (letter: string) => {
    const el = document.getElementById(`section-${letter}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const runDiagramAction = async (qId: string, mode: "generate" | "edit" | "regenerate", instruction?: string) => {
    if (!assessment) return false;
    const q = questions.find((x) => x.id === qId);
    if (!q) return false;
    const loadingMsg = mode === "edit" ? "Editing diagram…" : mode === "regenerate" ? "Regenerating diagram…" : "Generating diagram…";
    const toastId = toast.loading(loadingMsg);
    try {
      const { data, error } = await supabase.functions.invoke("generate-diagram", {
        body: {
          questionId: qId,
          topic: q.topic ?? assessment.subject,
          subject: assessment.subject,
          mode,
          instruction,
          currentDiagramUrl: q.diagram_url ?? undefined,
        },
      });
      if (error) {
        const ctx = (error as any)?.context;
        if (ctx?.status === 429) toast.error("Rate-limited, try again shortly", { id: toastId });
        else if (ctx?.status === 402) toast.error("Out of AI credits — top up to continue", { id: toastId });
        else toast.error("Diagram action failed", { id: toastId });
        return false;
      }
      if (data?.url) {
        const newUrl: string = data.url;
        const newSource: string = data.diagram_source ?? (mode === "edit" ? "ai_edited" : "ai_generated");
        setQuestions((qs) => qs.map((x) => {
          if (x.id !== qId) return x;
          const nextCaption = mode === "edit" ? x.diagram_caption : `${x.topic ?? assessment.subject} (AI-generated diagram)`;
          return { ...x, diagram_url: newUrl, diagram_source: newSource, diagram_citation: null, diagram_caption: nextCaption };
        }));
        const successMsg = mode === "edit" ? "Diagram updated" : mode === "regenerate" ? "Diagram regenerated" : "Diagram generated";
        toast.success(successMsg, { id: toastId });
        return true;
      }
      toast.error("No image returned", { id: toastId });
      return false;
    } catch (e) {
      console.error(e);
      toast.error("Diagram action failed", { id: toastId });
      return false;
    }
  };

  const removeDiagram = async (qId: string) => {
    setQuestions((qs) =>
      qs.map((x) =>
        x.id === qId
          ? { ...x, diagram_url: null, diagram_source: null, diagram_citation: null, diagram_caption: null }
          : x,
      ),
    );
    await supabase
      .from("assessment_questions")
      .update({ diagram_url: null, diagram_source: null, diagram_citation: null, diagram_caption: null })
      .eq("id", qId);
    toast.success("Diagram removed");
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

  const totalActual = questions.reduce((s, q) => s + q.marks, 0);
  const allSelected = questions.length > 0 && selectedIds.size === questions.length;
  const coverage = computeCoverage(questions, sectionedBlueprint.sections, aoDefs, assessment.total_marks);

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
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Invite reviewer
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
                <div className="mt-2 flex items-end gap-3">
                  <div className="w-44">
                    <label className="text-xs text-muted-foreground">Target difficulty</label>
                    <Select value={bulkRegenDifficulty} onValueChange={(v) => setBulkRegenDifficulty(v as typeof bulkRegenDifficulty)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep">Keep current</SelectItem>
                        <SelectItem value="easy">Easy</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="hard">Hard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => bulkRegenerate(bulkRegenInstr, bulkRegenDifficulty === "keep" ? undefined : bulkRegenDifficulty)}
                    className="gap-1"
                  >
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
                  <div key={q.id} id={`q-${q.id}`} className="space-y-3 scroll-mt-24">
                    {showHeader && sec && (
                      <div className="space-y-3 scroll-mt-24" id={`section-${sec.letter}`}>
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
                      subject={assessment.subject}
                      selected={selectedIds.has(q.id)}
                      onToggleSelect={() => toggleSelect(q.id)}
                      onUpdate={(patch) => updateQ(q.id, patch)}
                      onDelete={() => setConfirmDelete({ ids: [q.id], label: `Q${i + 1}` })}
                      onMove={(d) => moveQ(q.id, d)}
                      onRegenerate={(ins, diff) => regenerate(q.id, ins, diff)}
                      onBank={() => saveToBank(q)}
                      onDiagramAction={(mode, ins) => runDiagramAction(q.id, mode, ins)}
                      onDiagramRemove={() => removeDiagram(q.id)}
                      hideSourceBlock={isSbqSection}
                      comments={comments.filter((c) => c.question_id === q.id || (c.parent_id && comments.find((x) => x.id === c.parent_id)?.question_id === q.id))}
                      identity={identity}
                      onAddComment={(input) => addComment({ ...input, scope: "question", sectionLetter: sec?.letter ?? null, questionId: q.id })}
                      onSetCommentStatus={setCommentStatus}
                      onDeleteComment={deleteComment}
                    />
                  </div>
                );
              })
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <CoveragePanel
              coverage={coverage}
              totalMarks={assessment.total_marks}
              totalActual={totalActual}
            />

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

const SCIENCE_MATH_SUBJECTS = [
  "physics",
  "chemistry",
  "biology",
  "general science",
  "combined science",
  "science",
  "mathematics",
  "math",
  "maths",
  "additional mathematics",
];

function isScienceOrMathSubject(subject: string | undefined | null): boolean {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return SCIENCE_MATH_SUBJECTS.some((k) => s.includes(k));
}

function QuestionCard({
  q, index, isFirst, isLast, isRegen, subject, selected, onToggleSelect, onUpdate, onDelete, onMove, onRegenerate, onBank, onDiagramAction, onDiagramRemove, hideSourceBlock,
  comments, identity, onAddComment, onSetCommentStatus, onDeleteComment,
}: {
  q: Question; index: number; isFirst: boolean; isLast: boolean; isRegen: boolean;
  subject: string;
  selected: boolean;
  onToggleSelect: () => void;
  onUpdate: (patch: Partial<Question>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onRegenerate: (instruction: string, difficulty?: "easy" | "medium" | "hard") => void;
  onBank: () => void;
  onDiagramAction: (mode: "generate" | "edit" | "regenerate", instruction?: string) => Promise<boolean>;
  onDiagramRemove: () => void;
  hideSourceBlock?: boolean;
  comments: AssessmentComment[];
  identity: ReviewerIdentity;
  onAddComment: (input: { body: string; parentId: string | null }) => Promise<void>;
  onSetCommentStatus: (id: string, status: CommentStatus) => Promise<void>;
  onDeleteComment: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [stem, setStem] = useState(q.stem);
  const [answer, setAnswer] = useState(q.answer ?? "");
  const [scheme, setScheme] = useState(q.mark_scheme ?? "");
  const [marks, setMarks] = useState(q.marks);
  const [bloom, setBloom] = useState(q.bloom_level ?? "");
  const [showRegen, setShowRegen] = useState(false);
  const [regenInstr, setRegenInstr] = useState("");
  const [regenDifficulty, setRegenDifficulty] = useState<"keep" | "easy" | "medium" | "hard">("keep");
  const [diagramMode, setDiagramMode] = useState<"edit" | "regenerate" | null>(null);
  const [diagramInstr, setDiagramInstr] = useState("");
  const [diagramBusy, setDiagramBusy] = useState(false);

  const showDiagramTools = isScienceOrMathSubject(subject);

  const runDiagram = async (mode: "generate" | "edit" | "regenerate", instruction?: string) => {
    setDiagramBusy(true);
    const ok = await onDiagramAction(mode, instruction);
    setDiagramBusy(false);
    if (ok) {
      setDiagramMode(null);
      setDiagramInstr("");
    }
  };


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
          {q.difficulty && (
            <Badge variant="outline" className="capitalize">{q.difficulty}</Badge>
          )}
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
                  {q.diagram_source === "ai_edited" && (
                    <div className="mt-0.5 italic">AI-edited exam-style diagram</div>
                  )}
                </figcaption>
              </figure>
            )}
            {q.diagram_url && showDiagramTools && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={diagramBusy}
                  onClick={() => { setDiagramMode("edit"); setDiagramInstr(""); }}
                  className="gap-1"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Edit with prompt
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={diagramBusy}
                  onClick={() => { setDiagramMode("regenerate"); setDiagramInstr(""); }}
                  className="gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate diagram
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={diagramBusy}
                  onClick={() => {
                    if (confirm("Remove this diagram?")) onDiagramRemove();
                  }}
                  className="gap-1 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            )}
            {!q.diagram_url && showDiagramTools && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={diagramBusy}
                  onClick={() => runDiagram("generate")}
                  className="gap-1"
                >
                  {diagramBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  Generate diagram
                </Button>
              </div>
            )}
            {diagramMode && showDiagramTools && (
              <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs font-medium text-foreground">
                  {diagramMode === "edit" ? "Edit diagram" : "Regenerate diagram"}
                </div>
                <Textarea
                  rows={2}
                  value={diagramInstr}
                  onChange={(e) => setDiagramInstr(e.target.value)}
                  placeholder={
                    diagramMode === "edit"
                      ? "Describe the change — e.g. 'add a switch in series', 'relabel R₁ as 4Ω', 'shade the triangle'"
                      : "Optional: 'show side view instead', 'use a Bunsen burner', 'simpler labels'"
                  }
                  className="mt-2"
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={diagramBusy || (diagramMode === "edit" && !diagramInstr.trim())}
                    onClick={() => runDiagram(diagramMode, diagramInstr.trim() || undefined)}
                    className="gap-1"
                  >
                    {diagramBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={diagramBusy}
                    onClick={() => { setDiagramMode(null); setDiagramInstr(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
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
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div className="w-44">
              <label className="text-xs text-muted-foreground">Target difficulty</label>
              <Select value={regenDifficulty} onValueChange={(v) => setRegenDifficulty(v as typeof regenDifficulty)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep current{q.difficulty ? ` (${q.difficulty})` : ""}</SelectItem>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={isRegen}
              onClick={() => onRegenerate(regenInstr, regenDifficulty === "keep" ? undefined : regenDifficulty)}
              className="gap-1"
            >
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

// ───────────────────────────── Coverage helpers ─────────────────────────────

type Coverage = {
  paper: {
    aos: { code: string; title: string | null; target: number; actual: number; weighting: number | null }[];
    kos: { name: string; target: number; actual: number }[];
    los: { text: string; target: number; actual: number; covered: boolean }[];
    sectionMarks: { letter: string; target: number; actual: number }[];
  };
  bySection: Record<string, {
    letter: string;
    name: string;
    marks: { target: number; actual: number };
    aos: { code: string; title: string | null; actual: number }[];
    kos: { name: string; actual: number }[];
    los: { text: string; actual: number; covered: boolean }[];
  }>;
};

function computeCoverage(
  questions: Question[],
  sections: Section[],
  aoDefs: AODef[],
  totalMarks: number,
): Coverage {
  // Build a flat blueprint to map question position → section
  const sectionByPos: Section[] = [];
  let cursor = 0;
  for (const s of sections) {
    for (let i = 0; i < (s.num_questions || 0); i++) sectionByPos[cursor++] = s;
  }

  // ── Paper-wide AO targets from syllabus weightings + actuals from questions
  const aoCodeSet = new Set<string>();
  aoDefs.forEach((d) => aoCodeSet.add(d.code));
  sections.forEach((s) => (s.ao_codes ?? []).forEach((c) => aoCodeSet.add(c)));
  questions.forEach((q) => (q.ao_codes ?? []).forEach((c) => aoCodeSet.add(c)));

  const paperAOs = Array.from(aoCodeSet).sort().map((code) => {
    const def = aoDefs.find((d) => d.code === code) ?? null;
    const weighting = def?.weighting_percent ?? null;
    const target = weighting != null ? Math.round((weighting / 100) * totalMarks) : 0;
    const actual = questions.reduce((sum, q) => sum + ((q.ao_codes ?? []).includes(code) ? q.marks : 0), 0);
    return { code, title: def?.title ?? null, target, actual, weighting };
  });

  // ── Paper-wide KO targets from sections.knowledge_outcomes (sum of section marks
  //    listing the KO) + actuals from question.knowledge_outcomes
  const koSet = new Set<string>(KNOWLEDGE_OUTCOMES as readonly string[]);
  sections.forEach((s) => (s.knowledge_outcomes ?? []).forEach((k) => koSet.add(k)));
  questions.forEach((q) => (q.knowledge_outcomes ?? []).forEach((k) => koSet.add(k)));

  const paperKOs = Array.from(koSet).map((name) => {
    const target = sections.reduce((sum, s) => sum + ((s.knowledge_outcomes ?? []).includes(name) ? s.marks : 0), 0);
    const actual = questions.reduce((sum, q) => sum + ((q.knowledge_outcomes ?? []).includes(name) ? q.marks : 0), 0);
    return { name, target, actual };
  }).filter((k) => k.target > 0 || k.actual > 0);

  // ── Paper-wide LO list: union of every section's LOs + any LO seen on questions
  const loSet = new Set<string>();
  sections.forEach((s) => (s.learning_outcomes ?? []).forEach((lo) => loSet.add(lo)));
  questions.forEach((q) => (q.learning_outcomes ?? []).forEach((lo) => loSet.add(lo)));

  const paperLOs = Array.from(loSet).map((text) => {
    const target = sections.reduce((sum, s) => sum + ((s.learning_outcomes ?? []).includes(text) ? 1 : 0), 0);
    const actual = questions.reduce((sum, q) => sum + ((q.learning_outcomes ?? []).includes(text) ? 1 : 0), 0);
    return { text, target, actual, covered: actual > 0 };
  });

  // ── Section marks
  const sectionMarks = sections.map((s) => {
    let actual = 0;
    questions.forEach((q) => {
      const sec = sectionByPos[q.position];
      if (sec && sec.id === s.id) actual += q.marks;
    });
    return { letter: s.letter, target: s.marks, actual };
  });

  // ── Per-section breakdown
  const bySection: Coverage["bySection"] = {};
  for (const s of sections) {
    const qs = questions.filter((q) => sectionByPos[q.position]?.id === s.id);
    const aoCodes = new Set<string>([...(s.ao_codes ?? [])]);
    qs.forEach((q) => (q.ao_codes ?? []).forEach((c) => aoCodes.add(c)));
    const kos = new Set<string>([...(s.knowledge_outcomes ?? [])]);
    qs.forEach((q) => (q.knowledge_outcomes ?? []).forEach((c) => kos.add(c)));
    const los = new Set<string>([...(s.learning_outcomes ?? [])]);
    qs.forEach((q) => (q.learning_outcomes ?? []).forEach((c) => los.add(c)));

    bySection[s.id] = {
      letter: s.letter,
      name: s.name ?? "",
      marks: {
        target: s.marks,
        actual: qs.reduce((sum, q) => sum + q.marks, 0),
      },
      aos: Array.from(aoCodes).sort().map((code) => ({
        code,
        title: aoDefs.find((d) => d.code === code)?.title ?? null,
        actual: qs.reduce((sum, q) => sum + ((q.ao_codes ?? []).includes(code) ? q.marks : 0), 0),
      })),
      kos: Array.from(kos).map((name) => ({
        name,
        actual: qs.reduce((sum, q) => sum + ((q.knowledge_outcomes ?? []).includes(name) ? q.marks : 0), 0),
      })),
      los: Array.from(los).map((text) => ({
        text,
        actual: qs.reduce((sum, q) => sum + ((q.learning_outcomes ?? []).includes(text) ? 1 : 0), 0),
        covered: qs.some((q) => (q.learning_outcomes ?? []).includes(text)),
      })),
    };
  }

  return {
    paper: { aos: paperAOs, kos: paperKOs, los: paperLOs, sectionMarks },
    bySection,
  };
}

// ───────────────────────────── Coverage panel UI ─────────────────────────────

function MeterRow({
  label, sublabel, actual, target, showTarget = true,
}: { label: string; sublabel?: string | null; actual: number; target: number; showTarget?: boolean }) {
  const pct = target ? Math.min(100, (actual / target) * 100) : actual > 0 ? 100 : 0;
  const ok = target > 0 && actual >= target;
  const over = target > 0 && actual > target;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-medium text-foreground">{label}</span>
          {sublabel && <span className="ml-1 text-muted-foreground">{sublabel}</span>}
        </span>
        <span className={ok ? "text-success" : over ? "text-destructive" : "text-muted-foreground"}>
          {actual}{showTarget ? ` / ${target || "—"}` : ""} {ok && !over && "✓"}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${ok ? "bg-success" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function scrollToSection(letter: string) {
  const el = document.getElementById(`section-${letter}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function CoveragePanel({
  coverage, totalMarks, totalActual,
}: { coverage: Coverage; totalMarks: number; totalActual: number }) {
  const { paper, bySection } = coverage;
  const uncoveredLOs = paper.los.filter((l) => !l.covered);

  return (
    <>
      {/* Paper overview */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-medium">Paper overview</h3>
        <div className="mt-3 flex items-baseline gap-1">
          <span className={`font-paper text-3xl font-semibold ${totalActual === totalMarks ? "text-success" : "text-foreground"}`}>{totalActual}</span>
          <span className="text-sm text-muted-foreground">/ {totalMarks} marks</span>
        </div>
        {paper.sectionMarks.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {paper.sectionMarks.map((s) => {
              const ok = s.actual === s.target;
              return (
                <button
                  key={s.letter}
                  type="button"
                  onClick={() => scrollToSection(s.letter)}
                  className="flex w-full items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-muted"
                >
                  <span className="text-muted-foreground">Section {s.letter}</span>
                  <span className={ok ? "text-success" : "text-foreground"}>
                    {s.actual} / {s.target} {ok && "✓"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* AO Coverage */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-medium">AO Coverage</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Marks per Assessment Objective {paper.aos.some((a) => a.weighting != null) ? "(targets from syllabus weightings)" : ""}
        </p>
        <div className="mt-3 space-y-2.5">
          {paper.aos.length === 0 && (
            <p className="text-xs text-muted-foreground">No AOs tagged on this paper yet.</p>
          )}
          {paper.aos.map((a) => (
            <MeterRow
              key={a.code}
              label={a.code}
              sublabel={a.title ? `· ${a.title}${a.weighting != null ? ` (${a.weighting}%)` : ""}` : a.weighting != null ? `(${a.weighting}%)` : null}
              actual={a.actual}
              target={a.target}
            />
          ))}
        </div>
      </div>

      {/* KO Coverage */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-medium">KO Coverage</h3>
        <p className="mt-1 text-xs text-muted-foreground">Marks per Knowledge Outcome</p>
        <div className="mt-3 space-y-2.5">
          {paper.kos.length === 0 && (
            <p className="text-xs text-muted-foreground">No Knowledge Outcomes targeted.</p>
          )}
          {paper.kos.map((k) => (
            <MeterRow key={k.name} label={k.name} actual={k.actual} target={k.target} />
          ))}
        </div>
      </div>

      {/* LO Coverage */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-medium">LO Coverage</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {paper.los.length - uncoveredLOs.length} / {paper.los.length} learning outcomes covered
        </p>
        {paper.los.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">No Learning Outcomes targeted.</p>
        )}
        {uncoveredLOs.length > 0 && (
          <Collapsible defaultOpen className="mt-3">
            <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs font-medium text-destructive hover:underline">
              <ChevronRight className="h-3.5 w-3.5 transition-transform data-[state=open]:rotate-90" />
              {uncoveredLOs.length} uncovered
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1">
              {uncoveredLOs.map((lo) => (
                <p key={lo.text} className="rounded bg-muted/50 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                  · {lo.text}
                </p>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Per-section breakdown */}
      {Object.keys(bySection).length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-medium">Per-section breakdown</h3>
          <div className="mt-3 space-y-2">
            {Object.values(bySection).map((s, idx) => (
              <Collapsible key={s.letter} defaultOpen={idx === 0}>
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted/50">
                  <span className="flex items-center gap-2">
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                    <span className="font-medium">Section {s.letter}{s.name ? ` — ${s.name}` : ""}</span>
                  </span>
                  <span className={`text-xs ${s.marks.actual === s.marks.target ? "text-success" : "text-muted-foreground"}`}>
                    {s.marks.actual} / {s.marks.target}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-3 px-3 pb-2">
                  {s.aos.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AOs</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {s.aos.map((a) => (
                          <Badge key={a.code} variant="outline" className="text-[10px]">
                            {a.code} · {a.actual}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {s.kos.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">KOs</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {s.kos.map((k) => (
                          <Badge key={k.name} variant="outline" className="text-[10px]">
                            {k.name} · {k.actual}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {s.los.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        LOs · {s.los.filter((l) => l.covered).length} / {s.los.length} covered
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {s.los.map((lo) => (
                          <li key={lo.text} className={`text-[11px] leading-snug ${lo.covered ? "text-foreground" : "text-destructive"}`}>
                            {lo.covered ? "✓" : "○"} {lo.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => scrollToSection(s.letter)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Jump to section →
                  </button>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
