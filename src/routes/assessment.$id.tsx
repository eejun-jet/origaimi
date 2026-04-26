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
import { ArrowLeft, Loader2, RefreshCw, Trash2, BookmarkPlus, Sparkles, ChevronUp, ChevronDown, X, Download, Image as ImageIcon, Wand2, MessageCircle, UserPlus, AlertTriangle, Info, CheckCircle2, Pencil } from "lucide-react";
import { BLOOMS } from "@/lib/syllabus";
import { toSectioned, sectionAtPosition, getSbqSkill, KNOWLEDGE_OUTCOMES, isHumanitiesSubject, type Section } from "@/lib/sections";
import { expandQuestionTags } from "@/lib/coverage-infer";
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

  // While generation is in progress, poll for new questions / status changes.
  // The edge function may run longer than the API gateway's 150s timeout, so
  // the client must keep checking until rows actually land.
  const isGenerating = assessment?.status === "generating";
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      loadAll();
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, id]);

  // Realtime: also react instantly to new questions / status updates so we
  // don't have to wait for the next poll tick.
  useEffect(() => {
    if (!isGenerating) return;
    const channel = supabase
      .channel(`assessment-progress:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assessment_questions", filter: `assessment_id=eq.${id}` },
        () => loadAll(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "assessments", filter: `id=eq.${id}` },
        () => loadAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, id]);

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
  const coverage = computeCoverage(questions, sectionedBlueprint.sections, aoDefs, assessment.total_marks, assessment.subject);
  const questionLabels: Record<string, string> = {};
  questions.forEach((q, i) => {
    const sec = sectionAtPosition(sectionedBlueprint, i);
    questionLabels[q.id] = sec ? `Q${i + 1} · Section ${sec.letter}` : `Q${i + 1}`;
  });

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

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px]">
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
                {assessment.status === "generating" ? (
                  <>
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                    <p className="mt-3 text-sm font-medium text-foreground">
                      Drafting your paper…
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Source-grounded items can take 2–4 minutes. Questions will
                      appear here as soon as they are ready — you don't need to
                      refresh.
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => loadAll()} className="gap-1.5">
                        <RefreshCw className="h-3.5 w-3.5" /> Check now
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setStatus("generation_failed")}
                      >
                        Stop and mark as failed
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Sparkles className="mx-auto h-8 w-8 text-primary" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {assessment.status === "generation_failed"
                        ? "Generation failed before any questions could be saved. This usually means the source-fetching step took too long. Try a narrower topic or a different question type."
                        : "No questions yet."}
                    </p>
                  </>
                )}
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
                              {sectionSources.map((src) => (
                                <div
                                  key={src.label}
                                  className="rounded-lg border-l-4 border-primary bg-muted/40 p-4"
                                >
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                                    Source {src.label}
                                    {src.kind === "image" ? " · pictorial" : ""}
                                  </div>
                                  {src.provenance && (
                                    <p className="mt-1 font-paper text-xs italic leading-relaxed text-muted-foreground">
                                      {src.provenance}
                                    </p>
                                  )}
                                  {src.kind === "image" ? (
                                    <div className="mt-2 space-y-2">
                                      <img
                                        src={src.imageUrl}
                                        alt={src.caption}
                                        loading="lazy"
                                        className="max-h-80 w-auto rounded border border-border bg-background object-contain"
                                      />
                                      <p className="font-paper text-xs italic leading-relaxed text-muted-foreground">
                                        {src.caption}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="mt-2 font-paper text-sm italic leading-relaxed text-foreground whitespace-pre-wrap">
                                      {src.text}
                                    </p>
                                  )}
                                  {src.sourceUrl && (
                                    <p className="mt-2 text-[11px] text-muted-foreground">
                                      <a
                                        href={src.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                                      >
                                        View source
                                        <span aria-hidden="true"> ↗</span>
                                      </a>
                                      <span className="ml-2 text-muted-foreground/70">
                                        {(() => { try { return new URL(src.sourceUrl).hostname.replace(/^www\./, ""); } catch { return src.sourceUrl; } })()}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              ))}
                              {q.source_url && !sectionSources.some((s) => s.sourceUrl) && (
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

          <aside className="space-y-4 md:sticky md:top-20 md:self-start md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
            <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as "coverage" | "comments")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="coverage">Coverage</TabsTrigger>
                <TabsTrigger value="comments" className="gap-1.5">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Comments
                  {(() => {
                    const open = comments.filter((c) => !c.parent_id && c.status === "open").length;
                    return open > 0 ? (
                      <Badge variant="outline" className="h-4 border-destructive/30 px-1 text-[9px] text-destructive">
                        {open}
                      </Badge>
                    ) : null;
                  })()}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="coverage" className="mt-4 space-y-4">
                <CoveragePanel
                  coverage={coverage}
                  totalMarks={assessment.total_marks}
                  totalActual={totalActual}
                />

                <CoachPanel
                  assessmentId={id}
                  onScrollToQuestion={scrollToQuestion}
                  onApplied={loadAll}
                />

                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-medium">Total marks</h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className={`font-paper text-3xl font-semibold ${totalActual === assessment.total_marks ? "text-success" : "text-foreground"}`}>{totalActual}</span>
                    <span className="text-sm text-muted-foreground">/ {assessment.total_marks}</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="comments" className="mt-4">
                <CommentDock
                  comments={comments}
                  identity={identity}
                  onIdentityChange={setIdentity}
                  sectionLetters={sectionedBlueprint.sections.map((s) => s.letter)}
                  questionLabels={questionLabels}
                  onAdd={addComment}
                  onSetStatus={setCommentStatus}
                  onDelete={deleteComment}
                  onScrollToQuestion={scrollToQuestion}
                  onScrollToSection={scrollToSection}
                  onOpenInvite={() => setInviteOpen(true)}
                />
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </main>

      <InviteReviewerDialog
        assessmentId={id}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

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

/** A parsed source entry from the SBQ pool. Text sources have a `text` body; image
 *  sources have an `imageUrl` and a caption. Both kinds may carry a one-sentence
 *  `provenance` and a per-source `sourceUrl` (extracted from the [PROV]/[URL]
 *  markers added by the generator). */
type ParsedSource =
  | { label: string; kind: "text"; text: string; provenance?: string; sourceUrl?: string }
  | { label: string; kind: "image"; caption: string; imageUrl: string; provenance?: string; sourceUrl?: string };

/** Parse the generator's concatenated SBQ pool string ("Source A: …\n\nSource B: …")
 *  back into discrete labelled sources. Recognises:
 *    • new format: "Source A: [PROV] … [URL] … [TEXT] …"
 *    • new image format: "Source A: [IMAGE] caption — imageUrl [PROV] … [URL] …"
 *    • legacy format: "Source A: …" (plain text) and
 *      "Source A: [IMAGE] caption — imageUrl" (no provenance)
 *  Falls back to a single "A" entry when the excerpt does not match the
 *  multi-source pattern. */
function parseSharedSourcePool(excerpt: string): ParsedSource[] {
  const matches = [...excerpt.matchAll(/Source\s+([A-F])\s*:\s*([\s\S]*?)(?=\n\s*Source\s+[A-F]\s*:|$)/g)];
  const raw = matches.length === 0
    ? [{ label: "A", text: excerpt.trim() }]
    : matches.map((m) => ({ label: m[1], text: m[2].trim() }));
  return raw.map((entry): ParsedSource => {
    // Image (new format with provenance + URL markers)
    const imgWithMeta = entry.text.match(
      /^\[IMAGE\]\s*([\s\S]*?)\s+—\s+(https?:\/\/\S+?)\s+\[PROV\]\s*([\s\S]*?)\s+\[URL\]\s*(\S+)\s*$/,
    );
    if (imgWithMeta) {
      return {
        label: entry.label,
        kind: "image",
        caption: imgWithMeta[1].trim(),
        imageUrl: imgWithMeta[2].trim(),
        provenance: imgWithMeta[3].trim(),
        sourceUrl: imgWithMeta[4].trim(),
      };
    }
    // Image (legacy format)
    const imgLegacy = entry.text.match(/^\[IMAGE\]\s*([\s\S]*?)\s+—\s+(https?:\/\/\S+)\s*$/);
    if (imgLegacy) {
      return { label: entry.label, kind: "image", caption: imgLegacy[1].trim(), imageUrl: imgLegacy[2].trim() };
    }
    // Text (new format with provenance + URL markers)
    const textWithMeta = entry.text.match(
      /^\[PROV\]\s*([\s\S]*?)\s+\[URL\]\s*(\S+)\s+\[TEXT\]\s*([\s\S]*)$/,
    );
    if (textWithMeta) {
      return {
        label: entry.label,
        kind: "text",
        text: textWithMeta[3].trim(),
        provenance: textWithMeta[1].trim(),
        sourceUrl: textWithMeta[2].trim(),
      };
    }
    // Text (legacy format)
    return { label: entry.label, kind: "text", text: entry.text };
  });
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
  const [showComments, setShowComments] = useState(false);
  const commentRootCount = comments.filter((c) => !c.parent_id).length;
  const openCommentCount = comments.filter((c) => !c.parent_id && c.status === "open").length;

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
                {q.answer && (
                  <div className="mt-2">
                    <span className="font-medium">Answer:</span>
                    {/* Render as discrete paragraphs so essay model answers aren't a wall of text. */}
                    <div className="mt-1 space-y-2 font-paper leading-relaxed">
                      {q.answer.split(/\n\s*\n/).map((para, i) => (
                        <p key={i} className="whitespace-pre-wrap">{para.trim()}</p>
                      ))}
                    </div>
                  </div>
                )}
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
          <Button
            size="sm"
            variant={showComments ? "secondary" : "outline"}
            onClick={() => setShowComments((v) => !v)}
            className="gap-1 border-primary/40 text-primary hover:text-primary"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {commentRootCount > 0 ? `${commentRootCount} comment${commentRootCount === 1 ? "" : "s"}` : "Comment"}
            {openCommentCount > 0 && (
              <Badge variant="outline" className="ml-1 h-4 border-destructive/30 px-1 text-[9px] text-destructive">
                {openCommentCount} open
              </Badge>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} className="ml-auto gap-1 text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      )}

      {showComments && !editing && (
        <div className="mt-3 border-t border-border pt-3">
          <CommentThread
            comments={comments}
            identity={identity}
            scope="question"
            anchor={{ questionId: q.id, sectionLetter: null }}
            onAdd={({ body, parentId }) => onAddComment({ body, parentId })}
            onSetStatus={onSetCommentStatus}
            onDelete={onDeleteComment}
            compact
            hideScopeBadge
          />
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
  subject: string,
): Coverage {
  // Build a flat blueprint to map question position → section
  const sectionByPos: Section[] = [];
  let cursor = 0;
  for (const s of sections) {
    for (let i = 0; i < (s.num_questions || 0); i++) sectionByPos[cursor++] = s;
  }

  // ── Expand each question's tags using semantic inference against its
  //    section's LO/KO/AO pool. The teacher-visible tags on each question
  //    card stay unchanged; this expansion only feeds the coverage rollup
  //    so multi-LO questions stop being mislabelled as "uncovered".
  const inferKind: "humanities" | "english" | "science_math" | "other" =
    isHumanitiesSubject(subject) ? "humanities" : "science_math";
  const expandedById = new Map<string, { ao_codes: string[]; knowledge_outcomes: string[]; learning_outcomes: string[] }>();
  questions.forEach((q) => {
    const sec = sectionByPos[q.position];
    const poolAOs = sec
      ? ((sec.ao_codes && sec.ao_codes.length > 0)
          ? sec.ao_codes
          : Array.from(new Set((sec.topic_pool ?? []).flatMap((t) => t.ao_codes ?? []))))
      : [];
    const poolKOs = sec
      ? ((sec.knowledge_outcomes && sec.knowledge_outcomes.length > 0)
          ? sec.knowledge_outcomes
          : Array.from(new Set((sec.topic_pool ?? []).flatMap((t) => t.outcome_categories ?? []))))
      : [];
    const poolLOs = sec
      ? ((sec.learning_outcomes && sec.learning_outcomes.length > 0)
          ? sec.learning_outcomes
          : Array.from(new Set((sec.topic_pool ?? []).flatMap((t) => t.learning_outcomes ?? []))))
      : [];
    const ex = expandQuestionTags(
      { stem: q.stem, answer: q.answer, mark_scheme: q.mark_scheme, topic: q.topic, options: q.options ?? null },
      { ao_codes: q.ao_codes ?? [], knowledge_outcomes: q.knowledge_outcomes ?? [], learning_outcomes: q.learning_outcomes ?? [] },
      { loPool: poolLOs, koPool: poolKOs, aoPool: poolAOs },
      inferKind,
    );
    expandedById.set(q.id, ex);
  });
  const aoOf = (q: Question) => expandedById.get(q.id)?.ao_codes ?? q.ao_codes ?? [];
  const koOf = (q: Question) => expandedById.get(q.id)?.knowledge_outcomes ?? q.knowledge_outcomes ?? [];
  const loOf = (q: Question) => expandedById.get(q.id)?.learning_outcomes ?? q.learning_outcomes ?? [];

  // ── Paper-wide AO targets from syllabus weightings + actuals from questions
  const aoCodeSet = new Set<string>();
  aoDefs.forEach((d) => aoCodeSet.add(d.code));
  sections.forEach((s) => (s.ao_codes ?? []).forEach((c) => aoCodeSet.add(c)));
  questions.forEach((q) => aoOf(q).forEach((c) => aoCodeSet.add(c)));

  const paperAOs = Array.from(aoCodeSet).sort().map((code) => {
    const def = aoDefs.find((d) => d.code === code) ?? null;
    const weighting = def?.weighting_percent ?? null;
    const target = weighting != null ? Math.round((weighting / 100) * totalMarks) : 0;
    const actual = questions.reduce((sum, q) => sum + (aoOf(q).includes(code) ? q.marks : 0), 0);
    return { code, title: def?.title ?? null, target, actual, weighting };
  });

  // ── Paper-wide KO targets from sections.knowledge_outcomes (sum of section marks
  //    listing the KO) + actuals from question.knowledge_outcomes
  const koSet = new Set<string>(KNOWLEDGE_OUTCOMES as readonly string[]);
  sections.forEach((s) => (s.knowledge_outcomes ?? []).forEach((k) => koSet.add(k)));
  questions.forEach((q) => koOf(q).forEach((k) => koSet.add(k)));

  const paperKOs = Array.from(koSet).map((name) => {
    const target = sections.reduce((sum, s) => sum + ((s.knowledge_outcomes ?? []).includes(name) ? s.marks : 0), 0);
    const actual = questions.reduce((sum, q) => sum + (koOf(q).includes(name) ? q.marks : 0), 0);
    return { name, target, actual };
  }).filter((k) => k.target > 0 || k.actual > 0);

  // ── Paper-wide LO list: union of every section's LOs + any LO seen on questions
  const loSet = new Set<string>();
  sections.forEach((s) => (s.learning_outcomes ?? []).forEach((lo) => loSet.add(lo)));
  questions.forEach((q) => loOf(q).forEach((lo) => loSet.add(lo)));

  const paperLOs = Array.from(loSet).map((text) => {
    const target = sections.reduce((sum, s) => sum + ((s.learning_outcomes ?? []).includes(text) ? 1 : 0), 0);
    const actual = questions.reduce((sum, q) => sum + (loOf(q).includes(text) ? 1 : 0), 0);
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
    qs.forEach((q) => aoOf(q).forEach((c) => aoCodes.add(c)));
    const kos = new Set<string>([...(s.knowledge_outcomes ?? [])]);
    qs.forEach((q) => koOf(q).forEach((c) => kos.add(c)));
    const los = new Set<string>([...(s.learning_outcomes ?? [])]);
    qs.forEach((q) => loOf(q).forEach((c) => los.add(c)));

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
        actual: qs.reduce((sum, q) => sum + (aoOf(q).includes(code) ? q.marks : 0), 0),
      })),
      kos: Array.from(kos).map((name) => ({
        name,
        actual: qs.reduce((sum, q) => sum + (koOf(q).includes(name) ? q.marks : 0), 0),
      })),
      los: Array.from(los).map((text) => ({
        text,
        actual: qs.reduce((sum, q) => sum + (loOf(q).includes(text) ? 1 : 0), 0),
        covered: qs.some((q) => loOf(q).includes(text)),
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

// ───────────────────────────── Assessment Coach panel ─────────────────────────

type Severity = "info" | "warn" | "fail";

type CoachFindings = {
  summary: string;
  ao_drift: { ao_code: string; declared_pct?: number; observed_pct: number; delta_pct?: number; severity: Severity; note: string }[];
  command_word_issues: { question_id: string; position: number; detected_verb?: string; declared_ao?: string; expected_aos?: string[]; severity: Severity; note: string }[];
  unrealised_outcomes: { kos: string[]; los: string[]; note: string };
  bloom_curve: { section_letter: string; expected_progression?: string; observed_progression?: string; severity: Severity; note: string }[];
  source_fit_issues: { question_id: string; position: number; required_skill?: string; source_type?: string; severity: Severity; note: string }[];
  mark_scheme_flags: { question_id: string; position: number; marks_declared: number; marks_suggested?: number; severity: Severity; note: string }[];
  suggestions: { question_id?: string; position?: number; rewrite: string; rationale: string; category: string }[];
};

type CoachRun = {
  id: string;
  ran_at: string;
  model: string;
  total_actual_marks: number;
  total_marks: number;
  findings: CoachFindings;
};

function CoachPanel({
  assessmentId,
  onScrollToQuestion,
  onApplied,
}: {
  assessmentId: string;
  onScrollToQuestion: (questionId: string) => void;
  onApplied: () => void;
}) {
  const [runs, setRuns] = useState<CoachRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const loadRuns = async () => {
    const { data } = await supabase
      .from("assessment_versions")
      .select("id, snapshot, created_at")
      .eq("assessment_id", assessmentId)
      .like("label", "coach:%")
      .order("created_at", { ascending: false })
      .limit(10);
    const parsed: CoachRun[] = (data ?? [])
      .map((r: any) => {
        const s = r.snapshot ?? {};
        if (s.kind !== "coach_review" || !s.findings) return null;
        return {
          id: r.id,
          ran_at: s.ran_at ?? r.created_at,
          model: s.model ?? "",
          total_actual_marks: s.total_actual_marks ?? 0,
          total_marks: s.total_marks ?? 0,
          findings: s.findings as CoachFindings,
        } as CoachRun;
      })
      .filter(Boolean) as CoachRun[];
    setRuns(parsed);
    if (parsed.length > 0 && !activeRunId) setActiveRunId(parsed[0].id);
    setLoading(false);
  };

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  const runCoach = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("coach-review", {
        body: { assessmentId },
      });
      if (error) throw new Error(error.message || "Coach failed");
      const payload = data as { error?: string; run_id?: string };
      if (payload?.error) throw new Error(payload.error);
      toast.success("Coach review ready");
      setDismissed(new Set());
      await loadRuns();
      if (payload?.run_id) setActiveRunId(payload.run_id);
    } catch (e: any) {
      toast.error(e?.message ?? "Coach failed");
    } finally {
      setRunning(false);
    }
  };

  const applySuggestion = async (s: CoachFindings["suggestions"][number], key: string) => {
    if (!s.question_id) {
      toast.message("This is a paper-wide suggestion — apply it manually.");
      return;
    }
    setApplyingId(key);
    try {
      const { error } = await supabase
        .from("assessment_questions")
        .update({ stem: s.rewrite })
        .eq("id", s.question_id);
      if (error) throw error;
      setDismissed((prev) => new Set(prev).add(key));
      toast.success("Suggestion applied");
      onApplied();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not apply");
    } finally {
      setApplyingId(null);
    }
  };

  const activeRun = runs.find((r) => r.id === activeRunId) ?? null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Assessment Coach</h3>
        </div>
        <Button size="sm" onClick={runCoach} disabled={running} className="gap-1.5">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {running ? "Reviewing…" : runs.length > 0 ? "Re-run" : "Run Coach"}
        </Button>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading review history…</p>
      ) : runs.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Run the Coach to evaluate this paper against the AO framework, command-word
          conventions, and outcome coverage. Each run is saved so you can compare iterations.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Select
              value={activeRunId ?? undefined}
              onValueChange={(v) => { setActiveRunId(v); setDismissed(new Set()); }}
            >
              <SelectTrigger className="h-7 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {runs.map((r, i) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">
                    {i === 0 ? "Latest · " : ""}{new Date(r.ran_at).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeRun && <FindingTotals findings={activeRun.findings} dismissed={dismissed} />}
          </div>

          {activeRun && (
            <CoachReviewBody
              findings={activeRun.findings}
              dismissed={dismissed}
              onDismiss={(key) => setDismissed((prev) => new Set(prev).add(key))}
              onScrollToQuestion={onScrollToQuestion}
              onApply={applySuggestion}
              applyingId={applyingId}
            />
          )}
        </>
      )}
    </div>
  );
}

function FindingTotals({ findings, dismissed }: { findings: CoachFindings; dismissed: Set<string> }) {
  const all = collectFindings(findings);
  const visible = all.filter((f) => !dismissed.has(f.key));
  const fail = visible.filter((f) => f.severity === "fail").length;
  const warn = visible.filter((f) => f.severity === "warn").length;
  const info = visible.filter((f) => f.severity === "info").length;
  return (
    <div className="flex shrink-0 items-center gap-1 text-[10px]">
      {fail > 0 && <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive">{fail} fail</span>}
      {warn > 0 && <span className="rounded-full bg-warm/40 px-1.5 py-0.5 font-medium text-warm-foreground">{warn} warn</span>}
      {info > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">{info} info</span>}
      {fail + warn + info === 0 && <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-medium text-success">All clear</span>}
    </div>
  );
}

type FlatFinding = { key: string; severity: Severity };
function collectFindings(f: CoachFindings): FlatFinding[] {
  const out: FlatFinding[] = [];
  f.ao_drift?.forEach((x, i) => out.push({ key: `ao:${i}`, severity: x.severity }));
  f.command_word_issues?.forEach((x, i) => out.push({ key: `cw:${i}`, severity: x.severity }));
  f.bloom_curve?.forEach((x, i) => out.push({ key: `bc:${i}`, severity: x.severity }));
  f.source_fit_issues?.forEach((x, i) => out.push({ key: `sf:${i}`, severity: x.severity }));
  f.mark_scheme_flags?.forEach((x, i) => out.push({ key: `ms:${i}`, severity: x.severity }));
  const u = f.unrealised_outcomes;
  if (u && (u.kos?.length || u.los?.length)) out.push({ key: "uo:0", severity: "warn" });
  return out;
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "fail") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (severity === "warn") return <AlertTriangle className="h-3.5 w-3.5 text-warm-foreground" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
}

function CoachReviewBody({
  findings,
  dismissed,
  onDismiss,
  onScrollToQuestion,
  onApply,
  applyingId,
}: {
  findings: CoachFindings;
  dismissed: Set<string>;
  onDismiss: (key: string) => void;
  onScrollToQuestion: (id: string) => void;
  onApply: (s: CoachFindings["suggestions"][number], key: string) => void;
  applyingId: string | null;
}) {
  return (
    <div className="mt-3 space-y-2 text-xs">
      {findings.summary && (
        <div className="rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-foreground">
          {findings.summary}
        </div>
      )}

      <CoachSection
        title="AO drift"
        count={findings.ao_drift?.filter((_, i) => !dismissed.has(`ao:${i}`)).length ?? 0}
      >
        {findings.ao_drift?.map((d, i) => {
          const key = `ao:${i}`;
          if (dismissed.has(key)) return null;
          return (
            <FindingCard key={key} severity={d.severity} onDismiss={() => onDismiss(key)}>
              <div className="font-medium">{d.ao_code}{typeof d.observed_pct === "number" && <> · {d.observed_pct}%{typeof d.declared_pct === "number" && <span className="text-muted-foreground"> (target {d.declared_pct}%)</span>}</>}</div>
              <p className="mt-0.5 text-muted-foreground">{d.note}</p>
            </FindingCard>
          );
        })}
      </CoachSection>

      <CoachSection
        title="Command words"
        count={findings.command_word_issues?.filter((_, i) => !dismissed.has(`cw:${i}`)).length ?? 0}
      >
        {findings.command_word_issues?.map((d, i) => {
          const key = `cw:${i}`;
          if (dismissed.has(key)) return null;
          return (
            <FindingCard key={key} severity={d.severity} onDismiss={() => onDismiss(key)}
              onJump={d.question_id ? () => onScrollToQuestion(d.question_id) : undefined}>
              <div className="font-medium">Q{d.position + 1}{d.detected_verb && <> · "{d.detected_verb}"</>}</div>
              <p className="mt-0.5 text-muted-foreground">{d.note}</p>
              {d.expected_aos && d.expected_aos.length > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">Expected: {d.expected_aos.join(", ")}{d.declared_ao && <> · declared {d.declared_ao}</>}</p>
              )}
            </FindingCard>
          );
        })}
      </CoachSection>

      <CoachSection
        title="Unrealised KO/LO"
        count={dismissed.has("uo:0") ? 0 : ((findings.unrealised_outcomes?.kos?.length ?? 0) + (findings.unrealised_outcomes?.los?.length ?? 0) > 0 ? 1 : 0)}
      >
        {!dismissed.has("uo:0") && findings.unrealised_outcomes && (findings.unrealised_outcomes.kos?.length || findings.unrealised_outcomes.los?.length) ? (
          <FindingCard severity="warn" onDismiss={() => onDismiss("uo:0")}>
            {findings.unrealised_outcomes.note && <p className="text-muted-foreground">{findings.unrealised_outcomes.note}</p>}
            {findings.unrealised_outcomes.kos?.length > 0 && (
              <div className="mt-1">
                <span className="font-medium">KOs missed:</span>{" "}
                <span className="text-muted-foreground">{findings.unrealised_outcomes.kos.join("; ")}</span>
              </div>
            )}
            {findings.unrealised_outcomes.los?.length > 0 && (
              <div className="mt-1">
                <span className="font-medium">LOs missed:</span>{" "}
                <span className="text-muted-foreground">{findings.unrealised_outcomes.los.join("; ")}</span>
              </div>
            )}
          </FindingCard>
        ) : null}
      </CoachSection>

      <CoachSection
        title="Bloom & difficulty"
        count={findings.bloom_curve?.filter((_, i) => !dismissed.has(`bc:${i}`)).length ?? 0}
      >
        {findings.bloom_curve?.map((d, i) => {
          const key = `bc:${i}`;
          if (dismissed.has(key)) return null;
          return (
            <FindingCard key={key} severity={d.severity} onDismiss={() => onDismiss(key)}>
              <div className="font-medium">Section {d.section_letter}</div>
              <p className="mt-0.5 text-muted-foreground">{d.note}</p>
              {(d.expected_progression || d.observed_progression) && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {d.expected_progression && <>Expected: {d.expected_progression}</>}
                  {d.expected_progression && d.observed_progression && " · "}
                  {d.observed_progression && <>Observed: {d.observed_progression}</>}
                </p>
              )}
            </FindingCard>
          );
        })}
      </CoachSection>

      <CoachSection
        title="Source fit"
        count={findings.source_fit_issues?.filter((_, i) => !dismissed.has(`sf:${i}`)).length ?? 0}
      >
        {findings.source_fit_issues?.map((d, i) => {
          const key = `sf:${i}`;
          if (dismissed.has(key)) return null;
          return (
            <FindingCard key={key} severity={d.severity} onDismiss={() => onDismiss(key)}
              onJump={d.question_id ? () => onScrollToQuestion(d.question_id) : undefined}>
              <div className="font-medium">Q{d.position + 1}{d.required_skill && <> · {d.required_skill}</>}</div>
              <p className="mt-0.5 text-muted-foreground">{d.note}</p>
            </FindingCard>
          );
        })}
      </CoachSection>

      <CoachSection
        title="Mark scheme"
        count={findings.mark_scheme_flags?.filter((_, i) => !dismissed.has(`ms:${i}`)).length ?? 0}
      >
        {findings.mark_scheme_flags?.map((d, i) => {
          const key = `ms:${i}`;
          if (dismissed.has(key)) return null;
          return (
            <FindingCard key={key} severity={d.severity} onDismiss={() => onDismiss(key)}
              onJump={d.question_id ? () => onScrollToQuestion(d.question_id) : undefined}>
              <div className="font-medium">
                Q{d.position + 1} · {d.marks_declared}m
                {typeof d.marks_suggested === "number" && d.marks_suggested !== d.marks_declared && (
                  <span className="text-muted-foreground"> → suggest {d.marks_suggested}m</span>
                )}
              </div>
              <p className="mt-0.5 text-muted-foreground">{d.note}</p>
            </FindingCard>
          );
        })}
      </CoachSection>

      <CoachSection
        title="Suggestions"
        count={findings.suggestions?.filter((_, i) => !dismissed.has(`sg:${i}`)).length ?? 0}
      >
        {findings.suggestions?.map((s, i) => {
          const key = `sg:${i}`;
          if (dismissed.has(key)) return null;
          return (
            <div key={key} className="rounded-md border border-border bg-background/50 p-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="flex-1 space-y-1">
                  {typeof s.position === "number" && (
                    <button
                      className="text-[10px] font-medium uppercase tracking-wide text-primary hover:underline"
                      onClick={() => s.question_id && onScrollToQuestion(s.question_id)}
                    >
                      Q{s.position + 1} · {s.category}
                    </button>
                  )}
                  <p className="text-[11px] leading-relaxed text-foreground">{s.rewrite}</p>
                  <p className="text-[10px] text-muted-foreground">{s.rationale}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onDismiss(key)}>
                  Dismiss
                </Button>
                {s.question_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-2 text-[10px]"
                    onClick={() => onApply(s, key)}
                    disabled={applyingId === key}
                  >
                    {applyingId === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Apply
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CoachSection>
    </div>
  );
}

function CoachSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(count > 0);
  useEffect(() => { if (count > 0) setOpen(true); }, [count]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[11px] font-medium hover:bg-muted/40">
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {title}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${count > 0 ? "bg-muted text-foreground" : "text-muted-foreground"}`}>
          {count}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1.5">
        {count === 0 ? (
          <p className="px-1.5 text-[10px] text-muted-foreground">No findings.</p>
        ) : (
          children
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function FindingCard({
  severity,
  children,
  onDismiss,
  onJump,
}: {
  severity: Severity;
  children: React.ReactNode;
  onDismiss?: () => void;
  onJump?: () => void;
}) {
  const tone =
    severity === "fail"
      ? "border-destructive/30 bg-destructive/5"
      : severity === "warn"
      ? "border-warm/40 bg-warm/10"
      : "border-border bg-background/50";
  return (
    <div className={`rounded-md border p-2 ${tone}`}>
      <div className="flex items-start gap-2">
        <SeverityIcon severity={severity} />
        <div className="flex-1 text-[11px] leading-relaxed">{children}</div>
      </div>
      {(onDismiss || onJump) && (
        <div className="mt-1.5 flex items-center justify-end gap-1">
          {onJump && (
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={onJump}>
              Jump →
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
