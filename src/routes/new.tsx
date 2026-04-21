import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  SUBJECTS, LEVELS, ASSESSMENT_TYPES, QUESTION_TYPES, QUESTION_TYPES_BY_MODE, ITEM_SOURCES, BLOOMS, topicsFor,
} from "@/lib/syllabus";
import {
  loadSyllabusLibrary, loadPaperTopics,
  type SyllabusLibraryDoc, type SyllabusLibraryPaper, type PaperTopic,
} from "@/lib/syllabus-data";
import { ChevronLeft, ChevronRight, Sparkles, Loader2, BookOpen, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/new")({
  component: NewAssessment,
  head: () => ({ meta: [{ title: "Create assessment · Origaimi" }] }),
});

type BlueprintRow = {
  topic: string;
  bloom: string;
  marks: number;
  topic_code?: string | null;
  learning_outcomes?: string[];
};
type Blueprint = BlueprintRow[];

function NewAssessment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Syllabus library
  const [library, setLibrary] = useState<SyllabusLibraryDoc[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [selectedPaperKey, setSelectedPaperKey] = useState<string>(""); // `${docId}:${paperId}`
  const [paperTopics, setPaperTopics] = useState<PaperTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSyllabusLibrary()
      .then((docs) => { if (!cancelled) setLibrary(docs); })
      .catch((e) => toast.error(e.message ?? "Could not load syllabus library"))
      .finally(() => { if (!cancelled) setLibLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => {
    if (!selectedPaperKey) return null;
    const [docId, paperId] = selectedPaperKey.split(":");
    const doc = library.find((d) => d.id === docId);
    const paper = doc?.papers.find((p) => p.id === paperId);
    if (!doc || !paper) return null;
    return { doc, paper };
  }, [selectedPaperKey, library]);

  const useSyllabus = !!selected;

  // Step 1 / basics — auto-filled when a syllabus paper is selected
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [level, setLevel] = useState<string>("P5");
  const [aType, setAType] = useState<string>("topical");
  const [duration, setDuration] = useState(60);
  const [totalMarks, setTotalMarks] = useState(50);

  // When the selected paper changes, load its topics + prefill metadata
  useEffect(() => {
    if (!selected) {
      setPaperTopics([]);
      return;
    }
    const { doc, paper } = selected;
    if (doc.subject) setSubject(doc.subject);
    if (doc.level) setLevel(doc.level);
    if (paper.durationMinutes) setDuration(paper.durationMinutes);
    if (paper.marks) setTotalMarks(paper.marks);
    setTopicsLoading(true);
    loadPaperTopics(paper.id)
      .then((t) => setPaperTopics(t))
      .catch((e) => toast.error(e.message ?? "Could not load topics"))
      .finally(() => setTopicsLoading(false));
  }, [selected]);

  // Step 2 — topic selection
  const fallbackTopics = useMemo(() => topicsFor(subject, level), [subject, level]);

  // Section sub-selector (for multi-track papers like Combined Science 5086)
  const availableSections = useMemo(() => {
    if (!selected) return [];
    const tags = selected.paper.trackTags ?? [];
    if (tags.length > 1) return tags.map((t) => t.charAt(0).toUpperCase() + t.slice(1));
    const fromTopics = Array.from(new Set(paperTopics.map((t) => t.section).filter((s): s is string => !!s)));
    return fromTopics.length > 1 ? fromTopics : [];
  }, [selected, paperTopics]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  useEffect(() => {
    if (availableSections.length > 0) setActiveSection(availableSections[0]);
    else setActiveSection(selected?.paper.section ?? null);
  }, [availableSections, selected]);

  // For syllabus mode, only pick leaf-ish topics, optionally filtered by active section
  const selectableSyllabusTopics = useMemo(() => {
    let pool = paperTopics.filter((t) => t.depth >= 1 || paperTopics.every((x) => x.depth === 0));
    if (availableSections.length > 0 && activeSection) {
      pool = pool.filter((t) => !t.section || t.section.toLowerCase() === activeSection.toLowerCase());
    }
    return pool;
  }, [paperTopics, availableSections, activeSection]);

  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]); // fallback (non-syllabus) topic names

  useEffect(() => {
    setSelectedTopicIds([]);
    setTopics([]);
  }, [selectedPaperKey, subject, level, activeSection]);

  // Step 3 — blueprint
  const [blueprint, setBlueprint] = useState<Blueprint>([]);
  useEffect(() => {
    if (useSyllabus) {
      const picked = selectableSyllabusTopics.filter((t) => selectedTopicIds.includes(t.id));
      if (picked.length === 0) { setBlueprint([]); return; }
      const per = Math.max(1, Math.floor(totalMarks / picked.length));
      setBlueprint(picked.map((t) => ({
        topic: t.topicCode ? `${t.topicCode} · ${t.title}` : t.title,
        bloom: t.suggestedBlooms[0] ?? "Apply",
        marks: per,
        topic_code: t.topicCode,
        learning_outcomes: t.learningOutcomes,
      })));
    } else {
      if (topics.length === 0) { setBlueprint([]); return; }
      const per = Math.max(1, Math.floor(totalMarks / topics.length));
      setBlueprint(topics.map((t) => ({ topic: t, bloom: "Apply", marks: per })));
    }
  }, [useSyllabus, selectedTopicIds, topics, totalMarks, selectableSyllabusTopics]);

  // Step 4 — question types & sources (mode-aware defaults)
  const assessmentMode = selected?.paper.assessmentMode ?? "written";
  const visibleQuestionTypes = useMemo(() => {
    const allowedIds = QUESTION_TYPES_BY_MODE[assessmentMode] ?? QUESTION_TYPES_BY_MODE.written;
    // For written mode show everything except oral/listening-only types; for non-written hide written-only.
    if (assessmentMode === "written") {
      return QUESTION_TYPES.filter((t) => !["spoken_response", "listening_mcq", "note_taking"].includes(t.id));
    }
    return QUESTION_TYPES.filter((t) => allowedIds.includes(t.id));
  }, [assessmentMode]);
  const [qTypes, setQTypes] = useState<string[]>(["mcq", "short_answer", "structured"]);
  useEffect(() => {
    const defaults = QUESTION_TYPES_BY_MODE[assessmentMode] ?? ["mcq", "short_answer", "structured"];
    setQTypes(defaults);
  }, [assessmentMode]);
  const [sources, setSources] = useState<string[]>(["ai"]);

  // Step 5
  const [referenceNote, setReferenceNote] = useState("");

  const blueprintSum = blueprint.reduce((acc, b) => acc + (b.marks || 0), 0);

  const updateBlueprintRow = (i: number, patch: Partial<BlueprintRow>) => {
    setBlueprint((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const canNext = () => {
    if (step === 1) {
      if (libLoading) return false;
      if (library.length > 0 && !selected) return false; // must pick a paper if any exist
      return title.trim().length > 0;
    }
    if (step === 2) return useSyllabus ? selectedTopicIds.length > 0 : topics.length > 0;
    if (step === 3) return blueprintSum === totalMarks;
    if (step === 4) return qTypes.length > 0 && sources.length > 0;
    return true;
  };

  const handleGenerate = async () => {
    setBusy(true);
    const { data: created, error: e1 } = await supabase
      .from("assessments")
      .insert({
        user_id: user.id,
        title,
        subject,
        level,
        assessment_type: aType,
        duration_minutes: duration,
        total_marks: totalMarks,
        status: "draft",
        topics: useSyllabus
          ? blueprint.map((b) => b.topic)
          : topics,
        blueprint,
        question_types: qTypes,
        item_sources: sources,
        instructions: referenceNote || null,
        syllabus_doc_id: selected?.doc.id ?? null,
        syllabus_paper_id: selected?.paper.id ?? null,
        syllabus_code: selected?.paper.paperCode ?? selected?.doc.syllabusCode ?? null,
      })
      .select()
      .single();

    if (e1 || !created) {
      setBusy(false);
      return toast.error(e1?.message ?? "Could not create assessment");
    }

    const { data: gen, error: e2 } = await supabase.functions.invoke("generate-assessment", {
      body: {
        assessmentId: created.id,
        userId: user.id,
        title, subject, level,
        assessmentType: aType,
        durationMinutes: duration,
        totalMarks,
        topics: useSyllabus ? blueprint.map((b) => b.topic) : topics,
        blueprint,
        questionTypes: qTypes,
        itemSources: sources,
        instructions: referenceNote,
        syllabusCode: selected?.doc.syllabusCode ?? null,
        paperCode: selected?.paper.paperCode ?? null,
      },
    });

    setBusy(false);

    if (e2) {
      toast.error("Generation failed — opening empty draft");
    } else if (gen) {
      toast.success(`Drafted ${gen.questionCount ?? "your"} questions`);
    }
    navigate({ to: "/assessment/$id", params: { id: created.id } });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-paper text-2xl font-semibold tracking-tight">
            New assessment
          </h1>
          <span className="text-sm text-muted-foreground">Step {step} of 6</span>
        </div>

        <Stepper step={step} />

        <div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-paper text-xl font-semibold">Basics</h2>

              {/* Syllabus picker */}
              {libLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your syllabus library…
                </div>
              ) : library.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    <Upload className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 text-sm">
                      <p className="font-medium">Upload a syllabus to unlock code-tagged topics.</p>
                      <p className="mt-1 text-muted-foreground">
                        For now we'll use the curated MOE topic map. Pick subject and level below.
                      </p>
                      <Button asChild variant="outline" size="sm" className="mt-3">
                        <Link to="/admin/syllabus">Go to syllabus library</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5" /> Syllabus paper
                  </Label>
                  <Select value={selectedPaperKey} onValueChange={setSelectedPaperKey}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick the syllabus + paper to align to…" />
                    </SelectTrigger>
                    <SelectContent>
                      {library.map((doc) => (
                        <div key={doc.id}>
                          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {doc.syllabusCode ? `${doc.syllabusCode} · ` : ""}{doc.title}
                            {doc.syllabusYear ? ` (${doc.syllabusYear})` : ""}
                          </div>
                          {doc.papers.length === 0 ? (
                            <div className="px-3 py-1.5 text-xs italic text-muted-foreground">No parsed papers yet</div>
                          ) : doc.papers.map((p) => (
                            <SelectItem key={p.id} value={`${doc.id}:${p.id}`}>
                              {paperLabel(p)}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                  {selected && (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        Auto-filled from{" "}
                        <span className="font-medium text-foreground">
                          {selected.paper.paperCode ?? selected.doc.syllabusCode}
                        </span>.
                      </p>
                      {selected.paper.assessmentMode && selected.paper.assessmentMode !== "written" && (
                        <Badge variant="outline" className="capitalize">{selected.paper.assessmentMode}</Badge>
                      )}
                      {selected.paper.section && (
                        <Badge variant="secondary">{selected.paper.section}</Badge>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder={selected ? `${selected.doc.subject ?? ""} ${selected.doc.level ?? ""} — ${selected.paper.componentName ?? ""}`.trim() : "P5 Mathematics — Topical Test (Fractions)"} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select value={subject} onValueChange={setSubject}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      {selected?.doc.subject && !SUBJECTS.includes(selected.doc.subject as typeof SUBJECTS[number]) && (
                        <SelectItem value={selected.doc.subject}>{selected.doc.subject}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Level</Label>
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      {selected?.doc.level && !LEVELS.includes(selected.doc.level as typeof LEVELS[number]) && (
                        <SelectItem value={selected.doc.level}>{selected.doc.level}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Assessment type</Label>
                  <Select value={aType} onValueChange={setAType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASSESSMENT_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="duration">Duration (min)</Label>
                    <Input id="duration" type="number" min={10} value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="marks">Total marks</Label>
                    <Input id="marks" type="number" min={5} value={totalMarks}
                      onChange={(e) => setTotalMarks(Number(e.target.value))} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="font-paper text-xl font-semibold">Topics</h2>
              {useSyllabus ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    From <span className="font-medium text-foreground">{selected!.paper.paperCode ?? selected!.doc.syllabusCode}</span>
                    {selected!.paper.componentName ? ` · ${selected!.paper.componentName}` : ""}.
                  </p>
                  {availableSections.length > 1 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Section</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {availableSections.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setActiveSection(s)}
                            className={`rounded-full border px-3 py-1 text-xs transition-colors ${activeSection === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">This paper draws from multiple sections — pick which discipline to assess.</p>
                    </div>
                  )}
                  {topicsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading topics…
                    </div>
                  ) : selectableSyllabusTopics.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No topics parsed for this paper yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {selectableSyllabusTopics.map((t) => {
                        const checked = selectedTopicIds.includes(t.id);
                        const indent = Math.min(t.depth, 3);
                        return (
                          <label
                            key={t.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? "border-primary bg-primary-soft/40" : "border-border hover:bg-muted/40"}`}
                            style={{ marginLeft: indent * 16 }}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => setSelectedTopicIds((ids) => toggle(ids, t.id))}
                            />
                            <div className="flex-1 text-sm">
                              <div>
                                {t.topicCode && (
                                  <span className="mr-2 font-mono text-xs text-muted-foreground">{t.topicCode}</span>
                                )}
                                <span>{t.title}</span>
                              </div>
                              {t.learningOutcomes.length > 0 && (
                                <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                                  {t.learningOutcomes.slice(0, 2).join(" · ")}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Pick the syllabus topics to cover. {fallbackTopics.length === 0 && "No curated topics for this combo yet — we'll still draft, just describe in references."}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {fallbackTopics.map((t) => {
                      const checked = topics.includes(t);
                      return (
                        <label key={t} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? "border-primary bg-primary-soft/40" : "border-border hover:bg-muted/40"}`}>
                          <Checkbox checked={checked} onCheckedChange={() => setTopics(toggle(topics, t))} />
                          <span className="text-sm">{t}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="font-paper text-xl font-semibold">Table of Specifications</h2>
              <p className="text-sm text-muted-foreground">
                Set Bloom's level and marks per topic — your TOS. Total must equal {totalMarks} marks.
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Topic</th>
                      <th className="px-3 py-2">Bloom's</th>
                      <th className="px-3 py-2 text-right">Marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blueprint.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2">
                          {row.topic_code && (
                            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{row.topic_code}</span>
                          )}
                          {row.topic.replace(`${row.topic_code} · `, "")}
                        </td>
                        <td className="px-3 py-2">
                          <Select value={row.bloom} onValueChange={(v) => updateBlueprintRow(i, { bloom: v })}>
                            <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {BLOOMS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input type="number" min={1} value={row.marks}
                            className="ml-auto h-8 w-20 text-right"
                            onChange={(e) => updateBlueprintRow(i, { marks: Number(e.target.value) })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30">
                      <td className="px-3 py-2 font-medium" colSpan={2}>Total</td>
                      <td className={`px-3 py-2 text-right font-medium ${blueprintSum === totalMarks ? "text-success" : "text-destructive"}`}>
                        {blueprintSum} / {totalMarks}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-paper text-xl font-semibold">Question types</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick the mix you want in the paper.
                  {assessmentMode !== "written" && (
                    <span className="ml-1">Defaults tuned for <span className="font-medium capitalize text-foreground">{assessmentMode}</span> assessment.</span>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {visibleQuestionTypes.map((t) => {
                    const on = qTypes.includes(t.id);
                    return (
                      <button key={t.id} type="button" onClick={() => setQTypes(toggle(qTypes, t.id))}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <h2 className="font-paper text-xl font-semibold">Item sources</h2>
                <p className="mt-1 text-sm text-muted-foreground">Where should questions come from?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ITEM_SOURCES.map((t) => {
                    const on = sources.includes(t.id);
                    return (
                      <button key={t.id} type="button" onClick={() => setSources(toggle(sources, t.id))}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="font-paper text-xl font-semibold">References & instructions</h2>
              <p className="text-xs uppercase tracking-wide text-primary">Curated inspiration</p>
              <p className="text-sm text-muted-foreground">
                Optional: describe any style cues, past-paper patterns, or special instructions for the AI.
                Reference uploads coming soon.
              </p>
              <Textarea rows={6} value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)}
                placeholder="e.g. Mimic 2023 PSLE Math style. Include 1 word problem with a Singapore hawker centre context. Use SI units." />
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-primary" />
              <h2 className="font-paper text-2xl font-semibold">Ready to draft</h2>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                We'll write {totalMarks} marks of {blueprint.length}-topic questions matching your blueprint.
                You'll be able to edit, regenerate, and refine every question.
              </p>
              <ul className="mx-auto inline-flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                {selected?.paper.paperCode && (
                  <Badge variant="default">{selected.paper.paperCode}</Badge>
                )}
                <Badge variant="secondary">{subject}</Badge>
                <Badge variant="secondary">{level}</Badge>
                <Badge variant="secondary">{duration} min</Badge>
                <Badge variant="secondary">{totalMarks} marks</Badge>
                <Badge variant="secondary">{qTypes.length} question types</Badge>
              </ul>
              <Button size="lg" className="mt-4 gap-2" onClick={handleGenerate} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {busy ? "Drafting..." : "Generate assessment"}
              </Button>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" disabled={step === 1 || busy}
            onClick={() => setStep((s) => Math.max(1, s - 1))} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          {step < 6 ? (
            <Button disabled={!canNext()} onClick={() => setStep((s) => s + 1)} className="gap-1">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : <span />}
        </div>
      </main>
    </div>
  );
}

function paperLabel(p: SyllabusLibraryPaper) {
  const bits = [`Paper ${p.paperNumber}`];
  if (p.paperCode) bits.push(p.paperCode);
  if (p.componentName) bits.push(p.componentName);
  if (p.section) bits.push(p.section);
  const meta: string[] = [];
  if (p.assessmentMode && p.assessmentMode !== "written") {
    meta.push(p.assessmentMode.charAt(0).toUpperCase() + p.assessmentMode.slice(1));
  }
  if (p.marks) meta.push(`${p.marks}m`);
  if (p.durationMinutes) {
    const h = Math.floor(p.durationMinutes / 60);
    const m = p.durationMinutes % 60;
    meta.push(h > 0 ? `${h}h${m ? m : ""}` : `${m}min`);
  }
  return bits.join(" · ") + (meta.length ? ` (${meta.join(", ")})` : "");
}

function Stepper({ step }: { step: number }) {
  const labels = ["Basics", "Topics", "TOS", "Types", "References", "Generate"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={l} className="flex flex-1 items-center gap-2">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground" :
              done ? "bg-success text-success-foreground" :
              "bg-muted text-muted-foreground"
            }`}>{done ? "✓" : n}</div>
            <span className={`hidden text-xs sm:inline ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>{l}</span>
            {n < labels.length && <div className="h-px flex-1 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
