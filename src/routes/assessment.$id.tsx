import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { ArrowLeft, Loader2, RefreshCw, Trash2, BookmarkPlus, Sparkles, ChevronUp, ChevronDown, X, Download, Image as ImageIcon, Wand2, MessageCircle, UserPlus, AlertTriangle, Info, CheckCircle2, Pencil, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BLOOMS } from "@/lib/syllabus";
import { toSectioned, sectionAtPosition, getSbqSkill, KNOWLEDGE_OUTCOMES, isHumanitiesSubject, isScienceSubject, type Section } from "@/lib/sections";
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
  coverageKey,
  useReviewerIdentity,
} from "@/lib/comments";
import { DetailDrawer } from "@/components/DetailDrawer";
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
  assessment_type?: string | null;
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
  const [retagBusy, setRetagBusy] = useState(false);

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
    targetKind?: "ao" | "ko" | "lo" | "coach" | null;
    targetKey?: string | null;
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
      target_kind: input.targetKind ?? null,
      target_key: input.targetKey ?? null,
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

  const retagAllQuestions = async () => {
    if (retagBusy) return;
    if (!confirm(`Re-tag all ${questions.length} question${questions.length === 1 ? "" : "s"} with AI? This will overwrite existing AO / KO / LO tags based on each question's stem and the section's allowed pool.`)) return;
    setRetagBusy(true);
    const t = toast.loading("Re-tagging questions with AI…");
    try {
      const { data, error } = await supabase.functions.invoke("retag-questions", {
        body: { assessmentId: id },
      });
      if (error) throw new Error(error.message);
      const payload = data as { updated?: number; total?: number; errors?: { id: string; error: string }[]; error?: string };
      if (payload?.error) throw new Error(payload.error);
      await loadAll();
      const failed = payload?.errors?.length ?? 0;
      toast.success(
        `Re-tagged ${payload?.updated ?? 0} / ${payload?.total ?? 0} questions${failed > 0 ? ` (${failed} skipped)` : ""}`,
        { id: t },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: t });
    } finally {
      setRetagBusy(false);
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
              {assessment.assessment_type === "past_paper_analysis" && (
                <Link
                  to="/papers"
                  className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary hover:underline"
                >
                  Imported from past paper
                </Link>
              )}
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
                        {sectionSources && sectionSources.length > 0 && (() => {
                          const textSources = sectionSources.filter((s) => s.kind === "text");
                          const imageSources = sectionSources.filter((s) => s.kind === "image");
                          const renderSource = (src: ParsedSource) => (
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
                          );
                          return (
                            <div className="rounded-xl border border-border bg-card p-5">
                              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Sources for this section
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Refer to these sources when answering Section {sec.letter}.
                                {imageSources.length > 0 && textSources.length > 0
                                  ? " Documentary text sources appear first; pictorial sources are grouped separately below."
                                  : ""}
                              </p>
                              {textSources.length > 0 && (
                                <div className="mt-4 space-y-4">
                                  {imageSources.length > 0 && (
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                                      Documentary sources
                                    </p>
                                  )}
                                  {textSources.map(renderSource)}
                                </div>
                              )}
                              {imageSources.length > 0 && (
                                <div className="mt-6 space-y-4 border-t border-dashed border-border pt-4">
                                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                                    Pictorial sources ({imageSources.length})
                                  </p>
                                  {imageSources.map(renderSource)}
                                </div>
                              )}
                              {q.source_url && !sectionSources.some((s) => s.sourceUrl) && (
                                <p className="mt-3 text-xs text-muted-foreground">
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
                          );
                        })()}
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
                  assessmentId={id}
                  coverage={coverage}
                  totalMarks={assessment.total_marks}
                  totalActual={totalActual}
                  questions={questions}
                  comments={comments}
                  identity={identity}
                  subject={assessment.subject}
                  sections={sectionedBlueprint.sections}
                  onAddComment={addComment}
                  onSetCommentStatus={setCommentStatus}
                  onDeleteComment={deleteComment}
                  onScrollToQuestion={scrollToQuestion}
                  onRetag={retagAllQuestions}
                  retagBusy={retagBusy}
                />

                <CoachPanel
                  assessmentId={id}
                  onScrollToQuestion={scrollToQuestion}
                  onApplied={loadAll}
                  comments={comments}
                  identity={identity}
                  onAddComment={addComment}
                  onSetCommentStatus={setCommentStatus}
                  onDeleteComment={deleteComment}
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
        <div className="flex flex-wrap items-center justify-end gap-1">
          {!editing && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
                className="gap-1"
                title="Edit this question"
                aria-label="Edit question"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRegen((v) => !v)}
                className="gap-1"
                title="Regenerate this question with an optional prompt"
                aria-label="Regenerate question"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Regenerate</span>
              </Button>
            </>
          )}
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
                    <span className="font-medium">{q.question_type === "source_based" ? "Sample answer (L4):" : "Answer:"}</span>
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

// ───────────────────────────── Topics map (science papers) ─────────────────────

type TopicsMap = {
  disciplines: {
    name: string;
    totalLOs: number;
    coveredLOs: number;
    topics: {
      title: string;
      totalLOs: number;
      coveredLOs: number;
      los: { text: string; covered: boolean; actual: number }[];
    }[];
  }[];
};

const DISCIPLINE_ORDER = ["Physics", "Chemistry", "Biology", "Practical", "General"];

function normaliseDiscipline(s: string | null | undefined): string {
  if (!s) return "General";
  const t = s.toLowerCase();
  if (t.includes("physic")) return "Physics";
  if (t.includes("chem")) return "Chemistry";
  if (t.includes("bio")) return "Biology";
  if (t.includes("practical") || t.includes("experimental")) return "Practical";
  // Trim "Combined Science — " or similar prefixes; otherwise pass through.
  return s.split(/[—–-]/).slice(-1)[0]?.trim() || s;
}

function buildTopicsMap(
  paperLOs: Coverage["paper"]["los"],
  sections: Section[],
): TopicsMap {
  // (discipline, topicTitle) → Map<loText, {covered, actual}>
  const grouped = new Map<string, Map<string, Map<string, { covered: boolean; actual: number }>>>();
  // Lookup of paper LO stats
  const loStats = new Map(paperLOs.map((l) => [l.text, l] as const));

  const place = (discipline: string, topicTitle: string, loText: string) => {
    const stat = loStats.get(loText);
    if (!stat) return; // LO not in paper rollup → skip
    if (!grouped.has(discipline)) grouped.set(discipline, new Map());
    const disc = grouped.get(discipline)!;
    if (!disc.has(topicTitle)) disc.set(topicTitle, new Map());
    const topic = disc.get(topicTitle)!;
    if (!topic.has(loText)) {
      topic.set(loText, { covered: stat.covered, actual: stat.actual });
    }
  };

  // 1. Walk every section's topic_pool
  const seenLOs = new Set<string>();
  for (const s of sections) {
    for (const t of s.topic_pool ?? []) {
      const discipline = normaliseDiscipline(t.section);
      const topicTitle = t.topic || "Other";
      for (const lo of t.learning_outcomes ?? []) {
        place(discipline, topicTitle, lo);
        seenLOs.add(lo);
      }
    }
  }

  // 2. Any LO from the paper rollup that we never grouped → bucket under "Other / General"
  for (const l of paperLOs) {
    if (!seenLOs.has(l.text)) place("General", "Other", l.text);
  }

  const disciplines = Array.from(grouped.entries()).map(([name, topicsMap]) => {
    const topics = Array.from(topicsMap.entries()).map(([title, losMap]) => {
      const los = Array.from(losMap.entries()).map(([text, v]) => ({ text, ...v }));
      const coveredLOs = los.filter((l) => l.covered).length;
      // Stable: covered first within a topic? Keep insertion order (matches syllabus order).
      return { title, totalLOs: los.length, coveredLOs, los };
    });
    // Sort topics: uncovered first, then partial, then fully covered
    topics.sort((a, b) => {
      const aRatio = a.totalLOs ? a.coveredLOs / a.totalLOs : 0;
      const bRatio = b.totalLOs ? b.coveredLOs / b.totalLOs : 0;
      if (aRatio !== bRatio) return aRatio - bRatio;
      return a.title.localeCompare(b.title);
    });
    const totalLOs = topics.reduce((s, t) => s + t.totalLOs, 0);
    const coveredLOs = topics.reduce((s, t) => s + t.coveredLOs, 0);
    return { name, totalLOs, coveredLOs, topics };
  });

  // Sort disciplines: known order first, others alphabetical
  disciplines.sort((a, b) => {
    const ai = DISCIPLINE_ORDER.indexOf(a.name);
    const bi = DISCIPLINE_ORDER.indexOf(b.name);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return { disciplines };
}

function statusTone(covered: number, total: number): "success" | "warn" | "destructive" | "muted" {
  if (total === 0) return "muted";
  if (covered === 0) return "destructive";
  if (covered >= total) return "success";
  return "warn";
}

function SegmentBar({ covered, total }: { covered: number; total: number }) {
  const max = 12;
  const segs = Math.min(total, max);
  const filled = Math.round((covered / Math.max(1, total)) * segs);
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: segs }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-sm ${i < filled ? "bg-success" : "bg-muted-foreground/25"}`}
        />
      ))}
      {total > max && (
        <span className="ml-0.5 text-[9px] text-muted-foreground">+{total - max}</span>
      )}
    </div>
  );
}

type OverviewStatus = "untested" | "under" | "thin" | "balanced" | "over";

function classifyTopic(los: { covered: boolean; actual: number }[]): OverviewStatus {
  const total = los.length;
  if (total === 0) return "untested";
  const covered = los.filter((l) => l.covered).length;
  const maxActual = los.reduce((m, l) => Math.max(m, l.actual), 0);
  const avgActual = los.reduce((s, l) => s + l.actual, 0) / total;
  if (covered === 0) return "untested";
  if (covered === total) {
    if (maxActual >= 3 || avgActual > 2) return "over";
    return "balanced";
  }
  if (total >= 3 && covered / total < 0.34) return "under";
  return "thin";
}

const STATUS_META: Record<OverviewStatus, { label: string; chip: string; ring: string; sortKey: number }> = {
  untested: { label: "Untested", chip: "bg-destructive/15 text-destructive border-destructive/30", ring: "border-destructive/40", sortKey: 0 },
  under:    { label: "Under-tested", chip: "bg-destructive/10 text-destructive border-destructive/25", ring: "border-destructive/30", sortKey: 1 },
  thin:     { label: "Thin", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", ring: "border-amber-500/30", sortKey: 2 },
  over:     { label: "Over-tested", chip: "bg-warm/30 text-warm-foreground border-warm/50", ring: "border-warm/50", sortKey: 3 },
  balanced: { label: "Balanced", chip: "bg-success/15 text-success border-success/30", ring: "border-success/30", sortKey: 4 },
};

function CoverageDonut({ covered, total }: { covered: number; total: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : covered / total;
  const dash = c * pct;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
      <circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
      <circle
        cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeWidth="3"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeDashoffset={c / 4}
        strokeLinecap="round"
        className={pct === 0 ? "text-destructive/40" : pct < 0.34 ? "text-destructive" : pct < 1 ? "text-amber-500" : "text-success"}
        transform="rotate(-90 14 14)"
      />
    </svg>
  );
}

function DensityBar({ los }: { los: { covered: boolean; actual: number }[] }) {
  return (
    <div className="flex items-center gap-[2px]">
      {los.map((lo, i) => {
        const cls =
          lo.actual === 0 ? "bg-muted-foreground/20" :
          lo.actual === 1 ? "bg-success/40" :
          lo.actual === 2 ? "bg-success" :
          "bg-warm";
        return <span key={i} title={`${lo.actual}× tested`} className={`h-1.5 w-1.5 rounded-[1px] ${cls}`} />;
      })}
    </div>
  );
}

function TopicsOverviewView({
  map,
  remarkCount,
  setTarget,
  paperLOs,
}: {
  map: TopicsMap;
  remarkCount: (kind: "lo", value: string) => number;
  setTarget: (t: CoverageTarget) => void;
  paperLOs: Coverage["paper"]["los"];
}) {
  const loStats = new Map(paperLOs.map((l) => [l.text, l] as const));
  const [expanded, setExpanded] = useState<string | null>(null);
  if (map.disciplines.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">No Learning Outcomes targeted.</p>;
  }
  return (
    <div className="mt-3 space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground">Status:</span>
        {(["under", "thin", "over", "balanced", "untested"] as OverviewStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm border ${STATUS_META[s].chip}`} />
            {STATUS_META[s].label}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="font-medium text-foreground">Density:</span>
          <span className="h-1.5 w-1.5 rounded-[1px] bg-muted-foreground/20" />
          <span className="h-1.5 w-1.5 rounded-[1px] bg-success/40" />
          <span className="h-1.5 w-1.5 rounded-[1px] bg-success" />
          <span className="h-1.5 w-1.5 rounded-[1px] bg-warm" />
          <span>0×, 1×, 2×, 3+×</span>
        </span>
      </div>

      {map.disciplines.map((disc) => {
        const tiles = disc.topics
          .map((t) => ({ topic: t, status: classifyTopic(t.los) }))
          .sort((a, b) => {
            const k = STATUS_META[a.status].sortKey - STATUS_META[b.status].sortKey;
            if (k !== 0) return k;
            return a.topic.title.localeCompare(b.topic.title);
          });
        return (
          <div key={disc.name}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{disc.name}</h4>
              <span className="text-[10px] tabular-nums text-muted-foreground">{disc.coveredLOs} / {disc.totalLOs} LOs</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {tiles.map(({ topic: t, status }) => {
                const meta = STATUS_META[status];
                const key = `${disc.name}::${t.title}`;
                const isOpen = expanded === key;
                return (
                  <div key={key} className={`rounded-lg border bg-card transition ${meta.ring} ${isOpen ? "shadow-sm" : ""}`}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : key)}
                      className="flex w-full items-start gap-2 p-2.5 text-left hover:bg-muted/30"
                    >
                      <CoverageDonut covered={t.coveredLOs} total={t.totalLOs} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-1.5">
                          <span className="truncate text-[11px] font-medium leading-tight" title={t.title}>{t.title}</span>
                          <span className={`shrink-0 rounded border px-1 py-0 text-[9px] font-medium ${meta.chip}`}>{meta.label}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-[10px] tabular-nums text-muted-foreground">{t.coveredLOs}/{t.totalLOs} LOs</span>
                          <DensityBar los={t.los} />
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="space-y-0.5 border-t border-border/60 px-2.5 py-1.5">
                        {t.los.map((lo) => {
                          const count = remarkCount("lo", lo.text);
                          const stat = loStats.get(lo.text);
                          return (
                            <button
                              key={lo.text}
                              type="button"
                              onClick={() => stat && setTarget({ kind: "lo", text: stat.text, actual: stat.actual, target: stat.target, covered: stat.covered })}
                              className={`flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] leading-snug transition hover:bg-muted/50 ${lo.covered ? "text-foreground" : "text-muted-foreground"}`}
                            >
                              <span className={`mt-0.5 ${lo.covered ? "text-success" : "text-destructive"}`}>{lo.covered ? "✓" : "○"}</span>
                              <span className="flex-1">{lo.text}</span>
                              {lo.covered && lo.actual > 1 && (
                                <span className="shrink-0 text-[9px] text-muted-foreground">×{lo.actual}</span>
                              )}
                              {count > 0 && <RemarkPill count={count} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── LOs grouped by KO/topic, each topic collapsible. The "at-a-glance" view ──
function TopicsByKOView({
  map,
  remarkCount,
  setTarget,
  paperLOs,
}: {
  map: TopicsMap;
  remarkCount: (kind: "lo", value: string) => number;
  setTarget: (t: CoverageTarget) => void;
  paperLOs: Coverage["paper"]["los"];
}) {
  const loStats = new Map(paperLOs.map((l) => [l.text, l] as const));
  const [filter, setFilter] = useState<"all" | OverviewStatus>("all");
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());

  if (map.disciplines.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">No Learning Outcomes targeted.</p>;
  }

  const allTopicKeys: string[] = [];
  map.disciplines.forEach((d) => d.topics.forEach((t) => allTopicKeys.push(`${d.name}::${t.title}`)));

  const expandAll = () => setOpenTopics(new Set(allTopicKeys));
  const collapseAll = () => setOpenTopics(new Set());

  const toggle = (key: string) => {
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filterPills: ("all" | OverviewStatus)[] = ["all", "untested", "under", "thin", "balanced", "over"];

  return (
    <div className="mt-3 space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[10px]">
        <span className="font-medium text-foreground">Show:</span>
        {filterPills.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-2 py-0.5 transition ${
              filter === f
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "All topics" : STATUS_META[f].label}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-2">
          <button type="button" onClick={expandAll} className="text-muted-foreground hover:text-foreground">
            Expand all
          </button>
          <span className="text-muted-foreground/40">·</span>
          <button type="button" onClick={collapseAll} className="text-muted-foreground hover:text-foreground">
            Collapse all
          </button>
        </span>
      </div>

      {map.disciplines.map((disc) => {
        const tiles = disc.topics
          .map((t) => ({ topic: t, status: classifyTopic(t.los) }))
          .filter(({ status }) => filter === "all" || status === filter)
          .sort((a, b) => {
            const k = STATUS_META[a.status].sortKey - STATUS_META[b.status].sortKey;
            if (k !== 0) return k;
            return a.topic.title.localeCompare(b.topic.title);
          });
        if (tiles.length === 0) return null;
        return (
          <div key={disc.name}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{disc.name}</h4>
              <span className="text-[10px] tabular-nums text-muted-foreground">{disc.coveredLOs} / {disc.totalLOs} LOs</span>
            </div>
            <div className="space-y-1.5">
              {tiles.map(({ topic: t, status }) => {
                const meta = STATUS_META[status];
                const key = `${disc.name}::${t.title}`;
                const isOpen = openTopics.has(key);
                return (
                  <Collapsible key={key} open={isOpen} onOpenChange={() => toggle(key)}>
                    <div className={`rounded-lg border bg-card transition ${meta.ring} ${isOpen ? "shadow-sm" : ""}`}>
                      <CollapsibleTrigger className="group flex w-full items-center gap-2 p-2 text-left hover:bg-muted/30">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                        <CoverageDonut covered={t.coveredLOs} total={t.totalLOs} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="truncate text-[11px] font-medium leading-tight" title={t.title}>{t.title}</span>
                            <span className={`shrink-0 rounded border px-1 py-0 text-[9px] font-medium ${meta.chip}`}>{meta.label}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-[10px] tabular-nums text-muted-foreground">{t.coveredLOs}/{t.totalLOs} LOs</span>
                            <DensityBar los={t.los} />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-0.5 border-t border-border/60 px-2.5 py-1.5">
                          {t.los.map((lo) => {
                            const count = remarkCount("lo", lo.text);
                            const stat = loStats.get(lo.text);
                            return (
                              <button
                                key={lo.text}
                                type="button"
                                onClick={() => stat && setTarget({ kind: "lo", text: stat.text, actual: stat.actual, target: stat.target, covered: stat.covered })}
                                className={`flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] leading-snug transition hover:bg-muted/50 ${lo.covered ? "text-foreground" : "text-muted-foreground"}`}
                              >
                                <span className={`mt-0.5 ${lo.covered ? "text-success" : "text-destructive"}`}>{lo.covered ? "✓" : "○"}</span>
                                <span className="flex-1">{lo.text}</span>
                                {lo.covered && lo.actual > 1 && (
                                  <span className="shrink-0 text-[9px] text-muted-foreground">×{lo.actual}</span>
                                )}
                                {count > 0 && <RemarkPill count={count} />}
                              </button>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopicsMapView({
  map,
  remarkCount,
  setTarget,
  paperLOs,
}: {
  map: TopicsMap;
  remarkCount: (kind: "lo", value: string) => number;
  setTarget: (t: CoverageTarget) => void;
  paperLOs: Coverage["paper"]["los"];
}) {
  const loStats = new Map(paperLOs.map((l) => [l.text, l] as const));
  if (map.disciplines.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">No Learning Outcomes targeted.</p>;
  }
  return (
    <div className="mt-3 space-y-2">
      {map.disciplines.map((disc) => {
        const tone = statusTone(disc.coveredLOs, disc.totalLOs);
        const discDefaultOpen = disc.coveredLOs < disc.totalLOs; // open if anything missing
        return (
          <Collapsible key={disc.name} defaultOpen={discDefaultOpen}>
            <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-left text-xs hover:bg-muted/50">
              <span className="flex items-center gap-1.5">
                <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                <span className="font-medium">{disc.name}</span>
              </span>
              <span className="flex items-center gap-2">
                <SegmentBar covered={disc.coveredLOs} total={disc.totalLOs} />
                <span
                  className={
                    tone === "success" ? "text-success" :
                    tone === "destructive" ? "text-destructive" :
                    tone === "warn" ? "text-amber-600 dark:text-amber-400" :
                    "text-muted-foreground"
                  }
                >
                  {disc.coveredLOs} / {disc.totalLOs}
                </span>
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 space-y-1 pl-3">
              {disc.topics.map((t) => {
                const tTone = statusTone(t.coveredLOs, t.totalLOs);
                const tOpen = t.coveredLOs < t.totalLOs && t.coveredLOs < t.totalLOs;
                return (
                  <Collapsible key={t.title} defaultOpen={tOpen}>
                    <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] hover:bg-muted/40">
                      <span className="flex items-center gap-1.5">
                        <ChevronRight className="h-2.5 w-2.5 transition-transform group-data-[state=open]:rotate-90" />
                        <span
                          className={
                            tTone === "destructive" ? "font-medium text-destructive" :
                            tTone === "warn" ? "font-medium text-amber-600 dark:text-amber-400" :
                            tTone === "success" ? "font-medium text-success" :
                            "font-medium text-foreground"
                          }
                        >
                          {t.title}
                        </span>
                        {tTone === "destructive" && (
                          <span className="rounded bg-destructive/10 px-1 py-0 text-[9px] font-medium text-destructive">uncovered</span>
                        )}
                        {tTone === "warn" && (
                          <span className="rounded bg-amber-500/10 px-1 py-0 text-[9px] font-medium text-amber-700 dark:text-amber-400">thin</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <SegmentBar covered={t.coveredLOs} total={t.totalLOs} />
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {t.coveredLOs}/{t.totalLOs}
                        </span>
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-0.5 space-y-0.5 pl-4">
                      {t.los.map((lo) => {
                        const count = remarkCount("lo", lo.text);
                        const stat = loStats.get(lo.text);
                        return (
                          <button
                            key={lo.text}
                            type="button"
                            onClick={() => stat && setTarget({ kind: "lo", text: stat.text, actual: stat.actual, target: stat.target, covered: stat.covered })}
                            className={`flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] leading-snug transition hover:bg-muted/50 ${
                              lo.covered ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            <span className={`mt-0.5 ${lo.covered ? "text-success" : "text-destructive"}`}>
                              {lo.covered ? "✓" : "○"}
                            </span>
                            <span className="flex-1">{lo.text}</span>
                            {lo.covered && lo.actual > 1 && (
                              <span className="shrink-0 text-[9px] text-muted-foreground">×{lo.actual}</span>
                            )}
                            {count > 0 && <RemarkPill count={count} />}
                          </button>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Coverage panel UI ─────────────────────────────

function MeterRow({
  label, sublabel, actual, target, showTarget = true,
}: { label: React.ReactNode; sublabel?: string | null; actual: number; target: number; showTarget?: boolean }) {
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

type CoverageCommentHandlers = {
  comments: AssessmentComment[];
  identity: ReviewerIdentity;
  onAddComment: (input: {
    body: string;
    scope: CommentScope;
    parentId: string | null;
    sectionLetter: string | null;
    questionId: string | null;
    targetKind?: "ao" | "ko" | "lo" | "coach" | null;
    targetKey?: string | null;
  }) => Promise<void> | void;
  onSetCommentStatus: (commentId: string, status: CommentStatus) => Promise<void> | void;
  onDeleteComment: (commentId: string) => Promise<void> | void;
};

type CoverageTarget =
  | { kind: "ao"; code: string; title: string | null; actual: number; target: number; weighting: number | null }
  | { kind: "ko"; name: string; actual: number; target: number }
  | { kind: "lo"; text: string; actual: number; target: number; covered: boolean };

function RemarkPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-primary-soft px-1.5 py-0.5 text-[9px] font-medium text-primary">
      <MessageCircle className="h-2.5 w-2.5" />
      {count}
    </span>
  );
}

// ── Card-level collapse state, persisted per assessment in localStorage ─────
type CardKey = "ao" | "ko" | "lo" | "sections";
type CardCollapseAPI = {
  isOpen: (k: CardKey) => boolean;
  toggle: (k: CardKey) => void;
  set: (k: CardKey, v: boolean) => void;
};
function useCardCollapseState(assessmentId: string, defaults: Record<CardKey, boolean>): CardCollapseAPI {
  const storageKey = `origaimi.coverage.collapsed.${assessmentId}`;
  const [state, setState] = useState<Record<CardKey, boolean>>(defaults);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setState((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const persist = (next: Record<CardKey, boolean>) => {
    setState(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  return {
    isOpen: (k) => state[k],
    toggle: (k) => persist({ ...state, [k]: !state[k] }),
    set: (k, v) => persist({ ...state, [k]: v }),
  };
}

// Collapsible card shell with a header trigger row + chevron.
function CollapsibleCard({
  open,
  onOpenChange,
  title,
  description,
  summary,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex items-start gap-2 p-5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex flex-1 items-start gap-2 text-left"
              aria-label={open ? "Collapse" : "Expand"}
            >
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{title}</h3>
                {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
                {!open && summary && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{summary}</p>
                )}
              </div>
            </button>
          </CollapsibleTrigger>
          {actions && (
            <div
              className="flex shrink-0 items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          )}
        </div>
        <CollapsibleContent className="px-5 pb-5">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function CoveragePanel({
  assessmentId,
  coverage, totalMarks, totalActual, questions, comments, identity, subject, sections,
  onAddComment, onSetCommentStatus, onDeleteComment, onScrollToQuestion,
  onRetag, retagBusy,
}: {
  assessmentId: string;
  coverage: Coverage;
  totalMarks: number;
  totalActual: number;
  questions: Question[];
  subject: string;
  sections: Section[];
  onScrollToQuestion: (questionId: string) => void;
  onRetag?: () => void | Promise<void>;
  retagBusy?: boolean;
} & CoverageCommentHandlers) {
  const { paper, bySection } = coverage;
  const uncoveredLOs = paper.los.filter((l) => !l.covered);
  const [target, setTarget] = useState<CoverageTarget | null>(null);
  const isScience = isScienceSubject(subject);
  const [loView, setLoView] = useState<"topic" | "map" | "list">(isScience ? "topic" : "list");
  const topicsMap = useMemo(() => buildTopicsMap(paper.los, sections), [paper.los, sections]);

  // Card-level open/closed state, persisted per assessment.
  const cardOpen = useCardCollapseState(assessmentId, {
    ao: true,
    ko: false,
    lo: true,
    sections: false,
  });

  // ── Coverage Explorer (full-screen KO → LO drill-down) ──
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerKO, setExplorerKO] = useState<string | null>(null);
  const [explorerFilter, setExplorerFilter] = useState<"all" | OverviewStatus>("all");
  const [explorerMode, setExplorerMode] = useState<"overview" | "drilldown">("overview");

  // Build KO → list of LOs (with per-LO covered/actual) using questions as the
  // source of truth. Falls back to an "Unassigned" bucket for orphan LOs.
  const koLoGroups = useMemo(() => {
    const loStat = new Map(paper.los.map((l) => [l.text, l] as const));
    const koMap = new Map<string, Map<string, { covered: boolean; actual: number }>>();
    // Seed with all KOs (even if no questions tagged yet)
    for (const k of paper.kos) koMap.set(k.name, new Map());
    for (const q of questions) {
      const kos = q.knowledge_outcomes ?? [];
      const los = q.learning_outcomes ?? [];
      for (const ko of kos) {
        if (!koMap.has(ko)) koMap.set(ko, new Map());
        const bucket = koMap.get(ko)!;
        for (const lo of los) {
          const stat = loStat.get(lo);
          if (!stat) continue;
          if (!bucket.has(lo)) bucket.set(lo, { covered: stat.covered, actual: stat.actual });
        }
      }
    }
    // Orphan LOs (in paper rollup but never grouped under a KO)
    const grouped = new Set<string>();
    koMap.forEach((b) => b.forEach((_, lo) => grouped.add(lo)));
    const orphans = paper.los.filter((l) => !grouped.has(l.text));
    if (orphans.length > 0) {
      const bucket = new Map<string, { covered: boolean; actual: number }>();
      for (const l of orphans) bucket.set(l.text, { covered: l.covered, actual: l.actual });
      koMap.set("Unassigned", bucket);
    }
    // Materialise & enrich with marks from paper.kos
    const koMarks = new Map(paper.kos.map((k) => [k.name, k] as const));
    return Array.from(koMap.entries()).map(([name, bucket]) => {
      const los = Array.from(bucket.entries()).map(([text, v]) => ({ text, ...v }));
      const covered = los.filter((l) => l.covered).length;
      const marks = koMarks.get(name);
      const status: OverviewStatus = classifyTopic(los);
      return {
        name,
        los,
        coveredLOs: covered,
        totalLOs: los.length,
        actualMarks: marks?.actual ?? los.reduce((s, l) => s + l.actual, 0),
        targetMarks: marks?.target ?? 0,
        status,
      };
    }).sort((a, b) => {
      const ai = STATUS_META[a.status].sortKey;
      const bi = STATUS_META[b.status].sortKey;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
  }, [paper.kos, paper.los, questions]);

  const visibleKOs = explorerFilter === "all"
    ? koLoGroups
    : koLoGroups.filter((g) => g.status === explorerFilter);
  const selectedKO = explorerKO ? koLoGroups.find((g) => g.name === explorerKO) ?? null : null;

  // Map coverage comments by target_key for fast lookup
  const remarkCount = (kind: "ao" | "ko" | "lo", value: string) => {
    const key = coverageKey(kind, value);
    return comments.filter(
      (c) => c.scope === "coverage" && c.target_kind === kind && c.target_key === key && !c.parent_id,
    ).length;
  };

  // Find evidence questions for a target (per-paper rollup)
  const evidenceFor = (t: CoverageTarget): Question[] => {
    if (t.kind === "ao") return questions.filter((q) => (q.ao_codes ?? []).includes(t.code));
    if (t.kind === "ko") return questions.filter((q) => (q.knowledge_outcomes ?? []).includes(t.name));
    return questions.filter((q) => (q.learning_outcomes ?? []).includes(t.text));
  };

  const drawerProps = (() => {
    if (!target) return null;
    const kind = target.kind;
    const value = kind === "ao" ? target.code : kind === "ko" ? target.name : target.text;
    const key = coverageKey(kind, value);
    const targetComments = comments.filter(
      (c) => c.scope === "coverage" && c.target_kind === kind && c.target_key === key,
    );
    const evidence = evidenceFor(target);
    const titleLabel =
      kind === "ao" ? `${target.code}${target.title ? ` — ${target.title}` : ""}` :
      kind === "ko" ? target.name :
      target.text;
    const subtitle =
      kind === "lo"
        ? `${target.actual > 0 ? `Covered by ${target.actual} question${target.actual > 1 ? "s" : ""}` : "Not yet covered"}`
        : `${target.actual} / ${target.target || "—"} marks`;
    const badges: { label: string; tone?: "default" | "success" | "warn" | "destructive" }[] = [];
    if (kind === "ao" && target.weighting != null) badges.push({ label: `Target ${target.weighting}%` });
    if (kind === "lo") badges.push({ label: target.covered ? "Covered" : "Uncovered", tone: target.covered ? "success" : "destructive" });
    if (kind !== "lo") {
      const ok = target.target > 0 && target.actual >= target.target;
      const over = target.target > 0 && target.actual > target.target;
      badges.push({ label: ok && !over ? "On target" : over ? "Over target" : "Below target", tone: ok && !over ? "success" : over ? "warn" : "warn" });
    }
    return { kind, key, titleLabel, subtitle, badges, evidence, targetComments };
  })();

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
      {(() => {
        const onTarget = paper.aos.filter((a) => a.target > 0 && a.actual >= a.target && a.actual <= a.target + 0.5).length;
        const summary = paper.aos.length === 0
          ? "No AOs tagged on this paper yet."
          : `${onTarget} / ${paper.aos.length} AOs on target`;
        return (
          <CollapsibleCard
            open={cardOpen.isOpen("ao")}
            onOpenChange={(v) => cardOpen.set("ao", v)}
            title="AO Coverage"
            description={`Marks per Assessment Objective ${paper.aos.some((a) => a.weighting != null) ? "(targets from syllabus weightings)" : ""}`}
            summary={summary}
            actions={onRetag && questions.length > 0 ? (
              <button
                type="button"
                onClick={() => onRetag()}
                disabled={retagBusy}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
                title="Re-tag every question with AI based on its stem and the section's allowed AOs / KOs / LOs"
              >
                {retagBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Re-tag with AI
              </button>
            ) : undefined}
          >
            <p className="text-[10px] text-muted-foreground">Click any row for detail and to leave a remark.</p>
            <div className="mt-3 space-y-2.5">
              {paper.aos.length === 0 && (
                <p className="text-xs text-muted-foreground">No AOs tagged on this paper yet.</p>
              )}
              {paper.aos.map((a) => (
                <button
                  key={a.code}
                  type="button"
                  onClick={() => setTarget({ kind: "ao", ...a })}
                  className="block w-full rounded-md p-1 text-left transition hover:bg-muted/50"
                >
                  <MeterRow
                    label={
                      <>
                        {a.code}
                        <RemarkPill count={remarkCount("ao", a.code)} />
                      </>
                    }
                    sublabel={a.title ? `· ${a.title}${a.weighting != null ? ` (${a.weighting}%)` : ""}` : a.weighting != null ? `(${a.weighting}%)` : null}
                    actual={a.actual}
                    target={a.target}
                  />
                </button>
              ))}
            </div>
          </CollapsibleCard>
        );
      })()}

      {/* KO Coverage */}
      <CollapsibleCard
        open={cardOpen.isOpen("ko")}
        onOpenChange={(v) => cardOpen.set("ko", v)}
        title="KO Coverage"
        description="Marks per Knowledge Outcome"
        summary={paper.kos.length === 0 ? "No Knowledge Outcomes targeted." : `${paper.kos.length} topic${paper.kos.length === 1 ? "" : "s"} tracked`}
      >
        <div className="space-y-2.5">
          {paper.kos.length === 0 && (
            <p className="text-xs text-muted-foreground">No Knowledge Outcomes targeted.</p>
          )}
          {paper.kos.map((k) => (
            <button
              key={k.name}
              type="button"
              onClick={() => setTarget({ kind: "ko", ...k })}
              className="block w-full rounded-md p-1 text-left transition hover:bg-muted/50"
            >
              <MeterRow
                label={
                  <>
                    {k.name}
                    <RemarkPill count={remarkCount("ko", k.name)} />
                  </>
                }
                actual={k.actual}
                target={k.target}
              />
            </button>
          ))}
        </div>
      </CollapsibleCard>

      {/* LO Coverage */}
      <CollapsibleCard
        open={cardOpen.isOpen("lo")}
        onOpenChange={(v) => cardOpen.set("lo", v)}
        title="LO Coverage"
        description={`${paper.los.length - uncoveredLOs.length} / ${paper.los.length} learning outcomes covered`}
        summary={paper.los.length === 0
          ? "No Learning Outcomes targeted."
          : `${paper.los.length - uncoveredLOs.length} / ${paper.los.length} LOs covered · ${uncoveredLOs.length} untested`}
        actions={
          <>
            {isScience && paper.los.length > 0 && (
              <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setLoView("topic")}
                  className={`rounded px-2 py-0.5 transition ${loView === "topic" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  By topic
                </button>
                <button
                  type="button"
                  onClick={() => setLoView("map")}
                  className={`rounded px-2 py-0.5 transition ${loView === "map" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Map
                </button>
                <button
                  type="button"
                  onClick={() => setLoView("list")}
                  className={`rounded px-2 py-0.5 transition ${loView === "list" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Flat list
                </button>
              </div>
            )}
            {paper.los.length > 0 && (
              <button
                type="button"
                onClick={() => { setExplorerOpen(true); setExplorerKO(null); }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground transition hover:bg-muted"
                title="Open full Coverage Explorer"
              >
                <Maximize2 className="h-3 w-3" />
                Expand
              </button>
            )}
          </>
        }
      >
        {onRetag && (
          <button
            type="button"
            onClick={() => onRetag()}
            disabled={retagBusy || questions.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh LO coverage by re-tagging every question with AI based on its stem and the section's allowed AOs / KOs / LOs"
          >
            {retagBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {retagBusy ? "Refreshing LO analysis…" : "Refresh LO coverage analysis"}
          </button>
        )}
        {paper.los.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">No Learning Outcomes targeted.</p>
        )}
        {paper.los.length > 0 && isScience && loView === "topic" && (
          <TopicsByKOView
            map={topicsMap}
            remarkCount={remarkCount}
            setTarget={setTarget}
            paperLOs={paper.los}
          />
        )}
        {paper.los.length > 0 && isScience && loView === "map" && (
          <TopicsMapView
            map={topicsMap}
            remarkCount={remarkCount}
            setTarget={setTarget}
            paperLOs={paper.los}
          />
        )}
        {paper.los.length > 0 && (!isScience || loView === "list") && (
          <ul className="mt-3 space-y-1">
            {paper.los.map((lo) => {
              const count = remarkCount("lo", lo.text);
              return (
                <li key={lo.text}>
                  <button
                    type="button"
                    onClick={() => setTarget({ kind: "lo", ...lo })}
                    className={`flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-[11px] leading-snug transition hover:bg-muted/50 ${
                      lo.covered ? "text-foreground" : "text-destructive"
                    }`}
                  >
                    <span className="mt-0.5">{lo.covered ? "✓" : "○"}</span>
                    <span className="flex-1">{lo.text}</span>
                    {count > 0 && <RemarkPill count={count} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleCard>

      {/* Per-section breakdown */}
      {Object.keys(bySection).length > 0 && (
        <CollapsibleCard
          open={cardOpen.isOpen("sections")}
          onOpenChange={(v) => cardOpen.set("sections", v)}
          title="Per-section breakdown"
          summary={`${Object.keys(bySection).length} section${Object.keys(bySection).length === 1 ? "" : "s"}`}
        >
          <div className="space-y-2">
            {Object.values(bySection).map((s) => (
              <Collapsible key={s.letter}>
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
        </CollapsibleCard>
      )}

      {drawerProps && (
        <DetailDrawer
          open={!!target}
          onOpenChange={(o) => { if (!o) setTarget(null); }}
          title={drawerProps.titleLabel}
          subtitle={drawerProps.subtitle}
          badges={drawerProps.badges}
          scope="coverage"
          targetKind={drawerProps.kind}
          targetKey={drawerProps.key}
          comments={drawerProps.targetComments}
          identity={identity}
          onAddComment={onAddComment}
          onSetCommentStatus={onSetCommentStatus}
          onDeleteComment={onDeleteComment}
        >
          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence</h5>
            {drawerProps.evidence.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No questions on this paper currently address this item.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {drawerProps.evidence.map((q, i) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => { setTarget(null); onScrollToQuestion(q.id); }}
                      className="flex w-full items-start gap-2 rounded-md border border-border bg-card p-2 text-left text-xs hover:bg-muted/50"
                    >
                      <span className="font-medium text-primary">Q{q.position + 1}</span>
                      <span className="flex-1 text-muted-foreground line-clamp-2">{q.stem}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{q.marks}m</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DetailDrawer>
      )}

      {/* ── Coverage Explorer (full-screen KO → LO drill-down) ─────────── */}
      <Dialog open={explorerOpen} onOpenChange={(o) => { setExplorerOpen(o); if (!o) setExplorerKO(null); }}>
        <DialogContent className="max-w-6xl h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="font-paper text-lg">Coverage explorer</DialogTitle>
                <DialogDescription className="text-xs">
                  {koLoGroups.length} Knowledge Outcomes · {paper.los.length - uncoveredLOs.length} / {paper.los.length} Learning Outcomes covered.
                </DialogDescription>
              </div>
              <div className="shrink-0 inline-flex rounded-md border border-border bg-background p-0.5">
                {([
                  { key: "overview", label: "KO overview" },
                  { key: "drilldown", label: "Drill-down" },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setExplorerMode(m.key)}
                    className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition ${
                      explorerMode === m.key
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {([
                { key: "all", label: "All" },
                { key: "untested", label: "Untested" },
                { key: "under", label: "Under-tested" },
                { key: "thin", label: "Thin" },
                { key: "balanced", label: "Balanced" },
                { key: "over", label: "Over-tested" },
              ] as const).map((f) => {
                const count = f.key === "all"
                  ? koLoGroups.length
                  : koLoGroups.filter((g) => g.status === f.key).length;
                const active = explorerFilter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setExplorerFilter(f.key)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition ${
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f.label} <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
            </div>
          </DialogHeader>

          {explorerMode === "matrix" ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 p-4">
              {visibleKOs.length === 0 ? (
                <p className="px-2 py-12 text-center text-xs text-muted-foreground">
                  No Knowledge Outcomes match this filter.
                </p>
              ) : (
                <>
                  {/* Legend */}
                  <div className="mb-3 flex flex-wrap items-center gap-3 px-1 text-[10px] text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">Legend:</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Covered (tested)</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-700" />Tested ≥2×</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-border bg-background" />Not covered</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {visibleKOs.map((g) => {
                      const meta = STATUS_META[g.status];
                      return (
                        <div
                          key={g.name}
                          className="rounded-lg border border-border bg-card p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h4 className="text-xs font-semibold leading-snug">{g.name}</h4>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${meta.chip}`}>
                                  {meta.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {g.coveredLOs}/{g.totalLOs} LOs · {g.actualMarks}{g.targetMarks ? `/${g.targetMarks}` : ""}m
                                </span>
                              </div>
                            </div>
                            <CoverageDonut covered={g.coveredLOs} total={g.totalLOs} />
                          </div>
                          {g.los.length === 0 ? (
                            <p className="mt-2 text-[10px] italic text-muted-foreground">No LOs mapped.</p>
                          ) : (
                            <ul className="mt-2 space-y-0.5">
                              {g.los.map((lo) => {
                                const count = remarkCount("lo", lo.text);
                                const fullStat = paper.los.find((l) => l.text === lo.text);
                                const dotClass = !lo.covered
                                  ? "border border-border bg-background"
                                  : lo.actual >= 2
                                    ? "bg-emerald-700"
                                    : "bg-emerald-500";
                                return (
                                  <li key={lo.text}>
                                    <button
                                      type="button"
                                      onClick={() => { if (fullStat) setTarget({ kind: "lo", ...fullStat }); }}
                                      className={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[11px] leading-snug transition hover:bg-muted/50 ${
                                        lo.covered ? "text-foreground" : "text-muted-foreground"
                                      }`}
                                    >
                                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-sm ${dotClass}`} />
                                      <span className="flex-1">{lo.text}</span>
                                      {lo.actual > 0 && (
                                        <span className="shrink-0 text-[10px] text-muted-foreground">
                                          {lo.actual}×
                                        </span>
                                      )}
                                      {count > 0 && <RemarkPill count={count} />}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]">
            {/* Left: KO grid */}
            <div className="overflow-y-auto border-r border-border bg-muted/20 p-4">
              {visibleKOs.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                  No Knowledge Outcomes match this filter.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {visibleKOs.map((g) => {
                    const meta = STATUS_META[g.status];
                    const active = selectedKO?.name === g.name;
                    return (
                      <button
                        key={g.name}
                        type="button"
                        onClick={() => setExplorerKO(g.name)}
                        className={`rounded-lg border bg-card p-3 text-left transition hover:shadow-sm ${
                          active ? "border-primary ring-2 ring-primary/30" : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="line-clamp-2 text-xs font-semibold leading-snug">{g.name}</h4>
                          <CoverageDonut covered={g.coveredLOs} total={g.totalLOs} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${meta.chip}`}>
                            {meta.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {g.coveredLOs}/{g.totalLOs} LOs
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <DensityBar los={g.los} />
                          <span className="text-[10px] text-muted-foreground">
                            {g.actualMarks}{g.targetMarks ? ` / ${g.targetMarks}` : ""}m
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: LO detail for selected KO */}
            <div className="flex min-h-0 flex-col overflow-hidden">
              {!selectedKO ? (
                <div className="flex h-full items-center justify-center px-6 py-10 text-center">
                  <p className="max-w-xs text-xs text-muted-foreground">
                    Pick a Knowledge Outcome on the left to see every Learning Outcome inside it, with coverage status and remarks.
                  </p>
                </div>
              ) : (
                <>
                  <div className="border-b border-border px-5 py-3">
                    <h4 className="font-paper text-sm font-semibold">{selectedKO.name}</h4>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {selectedKO.coveredLOs} / {selectedKO.totalLOs} LOs covered · {selectedKO.actualMarks}{selectedKO.targetMarks ? ` / ${selectedKO.targetMarks}` : ""} marks
                    </p>
                    <span className={`mt-1.5 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${STATUS_META[selectedKO.status].chip}`}>
                      {STATUS_META[selectedKO.status].label}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-3 py-2">
                    {selectedKO.los.length === 0 ? (
                      <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                        No Learning Outcomes are mapped under this KO.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {selectedKO.los.map((lo) => {
                          const count = remarkCount("lo", lo.text);
                          const fullStat = paper.los.find((l) => l.text === lo.text);
                          return (
                            <li key={lo.text}>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!fullStat) return;
                                  setTarget({ kind: "lo", ...fullStat });
                                }}
                                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs leading-snug transition hover:bg-muted/50 ${
                                  lo.covered ? "text-foreground" : "text-destructive"
                                }`}
                              >
                                <span className="mt-0.5 shrink-0">{lo.covered ? "✓" : "○"}</span>
                                <span className="flex-1">{lo.text}</span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {lo.actual > 0 ? `${lo.actual}× tested` : "—"}
                                </span>
                                {count > 0 && <RemarkPill count={count} />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────────── Assessment Coach panel ─────────────────────────

type Severity = "info" | "warn" | "fail";

type CoachFindings = {
  summary: string;
  ao_drift: { ao_code: string; declared_pct?: number; observed_pct: number; delta_pct?: number; severity: Severity; note: string }[];
  unrealised_outcomes: { kos: string[]; los: string[]; note: string };
  source_fit_issues: { question_id: string; position: number; required_skill?: string; source_type?: string; severity: Severity; note: string }[];
  mark_scheme_flags: { question_id: string; position: number; marks_declared: number; marks_suggested?: number; severity: Severity; note: string }[];
  suggestions: { question_id?: string; position?: number; rewrite: string; rationale: string; category: string }[];
  calibration?: {
    has_specimen: boolean;
    specimen_title?: string;
    bloom_drift: { level: string; specimen_pct: number; observed_pct: number; delta: number; severity: Severity }[];
    ao_drift: { ao: string; specimen_pct: number; observed_pct: number; delta: number; severity: Severity }[];
    marks_shape_drift: { metric: string; specimen: number; observed: number; severity: Severity }[];
    command_word_gaps: string[];
    severity: Severity;
    note: string;
  };
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
  comments,
  identity,
  onAddComment,
  onSetCommentStatus,
  onDeleteComment,
}: {
  assessmentId: string;
  onScrollToQuestion: (questionId: string) => void;
  onApplied: () => void;
} & CoverageCommentHandlers) {
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

  // Drawer state: which finding the user clicked to discuss
  const [coachTarget, setCoachTarget] = useState<{
    key: string;
    title: string;
    subtitle?: string;
    severity: Severity;
    body: React.ReactNode;
    questionId?: string;
  } | null>(null);

  const buildTargetKey = (findingKey: string) =>
    activeRunId ? `${activeRunId}:${findingKey}` : findingKey;

  const remarkCountFor = (findingKey: string) => {
    const key = buildTargetKey(findingKey);
    return comments.filter(
      (c) => c.scope === "coach" && c.target_kind === "coach" && c.target_key === key && !c.parent_id,
    ).length;
  };

  const drawerComments = coachTarget
    ? comments.filter(
        (c) => c.scope === "coach" && c.target_kind === "coach" && c.target_key === buildTargetKey(coachTarget.key),
      )
    : [];

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
          Run the Coach to evaluate this paper against the AO framework and outcome
          coverage. Each run is saved so you can compare iterations.
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
              onDiscuss={(t) => setCoachTarget(t)}
              remarkCountFor={remarkCountFor}
            />
          )}
        </>
      )}

      {coachTarget && (
        <DetailDrawer
          open={!!coachTarget}
          onOpenChange={(o) => { if (!o) setCoachTarget(null); }}
          title={coachTarget.title}
          subtitle={coachTarget.subtitle}
          badges={[{
            label: coachTarget.severity === "fail" ? "Fail" : coachTarget.severity === "warn" ? "Warning" : "Info",
            tone: coachTarget.severity === "fail" ? "destructive" : coachTarget.severity === "warn" ? "warn" : "default",
          }]}
          scope="coach"
          targetKind="coach"
          targetKey={buildTargetKey(coachTarget.key)}
          comments={drawerComments}
          identity={identity}
          onAddComment={onAddComment}
          onSetCommentStatus={onSetCommentStatus}
          onDeleteComment={onDeleteComment}
        >
          <div className="rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
            {coachTarget.body}
          </div>
          {coachTarget.questionId && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 gap-1.5 text-xs"
              onClick={() => { const id = coachTarget.questionId!; setCoachTarget(null); onScrollToQuestion(id); }}
            >
              Jump to question →
            </Button>
          )}
        </DetailDrawer>
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
  f.source_fit_issues?.forEach((x, i) => out.push({ key: `sf:${i}`, severity: x.severity }));
  f.mark_scheme_flags?.forEach((x, i) => out.push({ key: `ms:${i}`, severity: x.severity }));
  const u = f.unrealised_outcomes;
  if (u && (u.kos?.length || u.los?.length)) out.push({ key: "uo:0", severity: "warn" });
  if (f.calibration?.has_specimen && f.calibration.severity !== "info") {
    out.push({ key: "cal:0", severity: f.calibration.severity });
  }
  return out;
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "fail") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (severity === "warn") return <AlertTriangle className="h-3.5 w-3.5 text-warm-foreground" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
}

type CoachDiscussTarget = {
  key: string;
  title: string;
  subtitle?: string;
  severity: Severity;
  body: React.ReactNode;
  questionId?: string;
};

function CoachReviewBody({
  findings,
  dismissed,
  onDismiss,
  onScrollToQuestion,
  onApply,
  applyingId,
  onDiscuss,
  remarkCountFor,
}: {
  findings: CoachFindings;
  dismissed: Set<string>;
  onDismiss: (key: string) => void;
  onScrollToQuestion: (id: string) => void;
  onApply: (s: CoachFindings["suggestions"][number], key: string) => void;
  applyingId: string | null;
  onDiscuss: (t: CoachDiscussTarget) => void;
  remarkCountFor: (key: string) => number;
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
            <FindingCard
              key={key}
              severity={d.severity}
              onDismiss={() => onDismiss(key)}
              remarkCount={remarkCountFor(key)}
              onDiscuss={() => onDiscuss({
                key,
                title: `AO drift · ${d.ao_code}`,
                subtitle: typeof d.observed_pct === "number"
                  ? `Observed ${d.observed_pct}%${typeof d.declared_pct === "number" ? ` · target ${d.declared_pct}%` : ""}`
                  : undefined,
                severity: d.severity,
                body: d.note,
              })}
            >
              <div className="font-medium">{d.ao_code}{typeof d.observed_pct === "number" && <> · {d.observed_pct}%{typeof d.declared_pct === "number" && <span className="text-muted-foreground"> (target {d.declared_pct}%)</span>}</>}</div>
              <p className="mt-0.5 text-muted-foreground">{d.note}</p>
            </FindingCard>
          );
        })}
      </CoachSection>

      <CoachSection
        title="Unrealised KO/LO"
        count={dismissed.has("uo:0") ? 0 : ((findings.unrealised_outcomes?.kos?.length ?? 0) + (findings.unrealised_outcomes?.los?.length ?? 0) > 0 ? 1 : 0)}
      >
        {!dismissed.has("uo:0") && findings.unrealised_outcomes && (findings.unrealised_outcomes.kos?.length || findings.unrealised_outcomes.los?.length) ? (
          <FindingCard
            severity="warn"
            onDismiss={() => onDismiss("uo:0")}
            remarkCount={remarkCountFor("uo:0")}
            onDiscuss={() => onDiscuss({
              key: "uo:0",
              title: "Unrealised KO/LO",
              severity: "warn",
              body: (
                <>
                  {findings.unrealised_outcomes.note && <p>{findings.unrealised_outcomes.note}</p>}
                  {findings.unrealised_outcomes.kos?.length > 0 && (
                    <p className="mt-1"><span className="font-medium">KOs:</span> {findings.unrealised_outcomes.kos.join("; ")}</p>
                  )}
                  {findings.unrealised_outcomes.los?.length > 0 && (
                    <p className="mt-1"><span className="font-medium">LOs:</span> {findings.unrealised_outcomes.los.join("; ")}</p>
                  )}
                </>
              ),
            })}
          >
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
        title="Source fit"
        count={findings.source_fit_issues?.filter((_, i) => !dismissed.has(`sf:${i}`)).length ?? 0}
      >
        {findings.source_fit_issues?.map((d, i) => {
          const key = `sf:${i}`;
          if (dismissed.has(key)) return null;
          return (
            <FindingCard
              key={key}
              severity={d.severity}
              onDismiss={() => onDismiss(key)}
              onJump={d.question_id ? () => onScrollToQuestion(d.question_id) : undefined}
              remarkCount={remarkCountFor(key)}
              onDiscuss={() => onDiscuss({
                key,
                title: `Source fit · Q${d.position + 1}`,
                subtitle: d.required_skill,
                severity: d.severity,
                body: d.note,
                questionId: d.question_id,
              })}
            >
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
            <FindingCard
              key={key}
              severity={d.severity}
              onDismiss={() => onDismiss(key)}
              onJump={d.question_id ? () => onScrollToQuestion(d.question_id) : undefined}
              remarkCount={remarkCountFor(key)}
              onDiscuss={() => onDiscuss({
                key,
                title: `Mark scheme · Q${d.position + 1}`,
                subtitle: typeof d.marks_suggested === "number" && d.marks_suggested !== d.marks_declared
                  ? `${d.marks_declared}m → suggest ${d.marks_suggested}m`
                  : `${d.marks_declared}m`,
                severity: d.severity,
                body: d.note,
                questionId: d.question_id,
              })}
            >
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
        title="Calibration vs specimen"
        count={findings.calibration?.has_specimen && findings.calibration.severity !== "info" && !dismissed.has("cal:0") ? 1 : 0}
      >
        {findings.calibration ? (
          !findings.calibration.has_specimen ? (
            <p className="text-[11px] text-muted-foreground">{findings.calibration.note}</p>
          ) : !dismissed.has("cal:0") ? (
            <FindingCard
              severity={findings.calibration.severity}
              onDismiss={() => onDismiss("cal:0")}
              remarkCount={remarkCountFor("cal:0")}
              onDiscuss={() => onDiscuss({
                key: "cal:0",
                title: "Calibration vs specimen",
                subtitle: findings.calibration!.specimen_title,
                severity: findings.calibration!.severity,
                body: (
                  <>
                    <p>{findings.calibration!.note}</p>
                    {findings.calibration!.bloom_drift.length > 0 && <p className="mt-2 font-medium">Bloom mix drift</p>}
                    {findings.calibration!.bloom_drift.map((b) => (
                      <p key={b.level} className="text-[11px] text-muted-foreground">
                        {b.level}: specimen {b.specimen_pct}% · observed {b.observed_pct}% (Δ {b.delta > 0 ? "+" : ""}{b.delta})
                      </p>
                    ))}
                    {findings.calibration!.ao_drift.length > 0 && <p className="mt-2 font-medium">AO mark-share drift</p>}
                    {findings.calibration!.ao_drift.map((a) => (
                      <p key={a.ao} className="text-[11px] text-muted-foreground">
                        {a.ao}: specimen {a.specimen_pct}% · observed {a.observed_pct}% (Δ {a.delta > 0 ? "+" : ""}{a.delta})
                      </p>
                    ))}
                    {findings.calibration!.marks_shape_drift.length > 0 && <p className="mt-2 font-medium">Marks shape</p>}
                    {findings.calibration!.marks_shape_drift.map((m) => (
                      <p key={m.metric} className="text-[11px] text-muted-foreground">
                        {m.metric}: specimen {m.specimen} · observed {m.observed}
                      </p>
                    ))}
                    {findings.calibration!.command_word_gaps.length > 0 && (
                      <p className="mt-2 text-[11px]"><span className="font-medium">Command words missing vs specimen:</span> {findings.calibration!.command_word_gaps.join(", ")}</p>
                    )}
                  </>
                ),
              })}
            >
              <div className="font-medium">
                {findings.calibration.specimen_title ? `vs ${findings.calibration.specimen_title}` : "vs specimen"}
              </div>
              <p className="mt-0.5 text-muted-foreground">{findings.calibration.note}</p>
            </FindingCard>
          ) : null
        ) : (
          <p className="text-[11px] text-muted-foreground">Calibration not available for this run.</p>
        )}
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
  // Default collapsed — Coach panels are long; users opt in per section.
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        disabled={count === 0}
        className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[11px] font-medium hover:bg-muted/40 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className="flex items-center gap-1.5">
          {count === 0
            ? <span className="inline-block h-3 w-3" />
            : open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {title}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${count > 0 ? "bg-muted text-foreground" : "text-muted-foreground"}`}>
          {count}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1.5">
        {count === 0 ? null : children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function FindingCard({
  severity,
  children,
  onDismiss,
  onJump,
  onDiscuss,
  remarkCount = 0,
}: {
  severity: Severity;
  children: React.ReactNode;
  onDismiss?: () => void;
  onJump?: () => void;
  onDiscuss?: () => void;
  remarkCount?: number;
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
        {remarkCount > 0 && <RemarkPill count={remarkCount} />}
      </div>
      {(onDismiss || onJump || onDiscuss) && (
        <div className="mt-1.5 flex items-center justify-end gap-1">
          {onDiscuss && (
            <Button size="sm" variant="ghost" className="h-5 gap-1 px-1.5 text-[10px]" onClick={onDiscuss}>
              <MessageCircle className="h-3 w-3" />
              Discuss
            </Button>
          )}
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
