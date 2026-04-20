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
  SUBJECTS, LEVELS, ASSESSMENT_TYPES, QUESTION_TYPES, ITEM_SOURCES, BLOOMS, topicsFor,
} from "@/lib/syllabus";
import { ChevronLeft, ChevronRight, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/new")({
  component: NewAssessment,
  head: () => ({ meta: [{ title: "Create assessment · Joy of Assessment" }] }),
});

type Blueprint = { topic: string; bloom: string; marks: number }[];

function NewAssessment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [level, setLevel] = useState<string>("P5");
  const [aType, setAType] = useState<string>("topical");
  const [duration, setDuration] = useState(60);
  const [totalMarks, setTotalMarks] = useState(50);

  // Step 2
  const availableTopics = useMemo(() => topicsFor(subject, level), [subject, level]);
  const [topics, setTopics] = useState<string[]>([]);
  useEffect(() => { setTopics([]); }, [subject, level]);

  // Step 3
  const [blueprint, setBlueprint] = useState<Blueprint>([]);
  useEffect(() => {
    if (topics.length === 0) { setBlueprint([]); return; }
    // Auto-suggest: distribute marks evenly across topics, default Bloom = Apply
    const per = Math.max(1, Math.floor(totalMarks / topics.length));
    setBlueprint(topics.map((t) => ({ topic: t, bloom: "Apply", marks: per })));
  }, [topics, totalMarks]);

  // Step 4
  const [qTypes, setQTypes] = useState<string[]>(["mcq", "short_answer", "structured"]);
  const [sources, setSources] = useState<string[]>(["ai"]);

  // Step 5: skipping references upload UI for MVP brevity (placeholder note)
  const [referenceNote, setReferenceNote] = useState("");

  const blueprintSum = blueprint.reduce((acc, b) => acc + (b.marks || 0), 0);

  const updateBlueprintRow = (i: number, patch: Partial<Blueprint[number]>) => {
    setBlueprint((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const canNext = () => {
    if (step === 1) return title.trim().length > 0;
    if (step === 2) return topics.length > 0;
    if (step === 3) return blueprintSum === totalMarks;
    if (step === 4) return qTypes.length > 0 && sources.length > 0;
    return true;
  };

  const handleGenerate = async () => {
    if (!user) return;
    setBusy(true);
    // 1. Create assessment row
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
        topics,
        blueprint,
        question_types: qTypes,
        item_sources: sources,
        instructions: referenceNote || null,
      })
      .select()
      .single();

    if (e1 || !created) {
      setBusy(false);
      return toast.error(e1?.message ?? "Could not create assessment");
    }

    // 2. Call edge function to generate questions
    const { data: gen, error: e2 } = await supabase.functions.invoke("generate-assessment", {
      body: {
        assessmentId: created.id,
        title, subject, level,
        assessmentType: aType,
        durationMinutes: duration,
        totalMarks,
        topics,
        blueprint,
        questionTypes: qTypes,
        itemSources: sources,
        instructions: referenceNote,
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
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="P5 Mathematics — Topical Test (Fractions)" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select value={subject} onValueChange={setSubject}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Level</Label>
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
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
              <p className="text-sm text-muted-foreground">
                Pick the syllabus topics to cover. {availableTopics.length === 0 && "No curated topics for this combo yet — we'll still draft, just describe in references."}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableTopics.map((t) => {
                  const checked = topics.includes(t);
                  return (
                    <label key={t} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? "border-primary bg-primary-soft/40" : "border-border hover:bg-muted/40"}`}>
                      <Checkbox checked={checked} onCheckedChange={() => setTopics(toggle(topics, t))} />
                      <span className="text-sm">{t}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="font-paper text-xl font-semibold">Blueprint</h2>
              <p className="text-sm text-muted-foreground">
                Set Bloom's level and marks per topic. Total must equal {totalMarks} marks.
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
                        <td className="px-3 py-2">{row.topic}</td>
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
                <p className="mt-1 text-sm text-muted-foreground">Pick the mix you want in the paper.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUESTION_TYPES.map((t) => {
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
                We'll write {totalMarks} marks of {topics.length}-topic questions matching your blueprint.
                You'll be able to edit, regenerate, and refine every question.
              </p>
              <ul className="mx-auto inline-flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
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

function Stepper({ step }: { step: number }) {
  const labels = ["Basics", "Topics", "Blueprint", "Types", "References", "Generate"];
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
