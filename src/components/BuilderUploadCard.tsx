// Lets a teacher drop an existing PDF (complete or in-progress) into the
// Assessment Builder. We upload to the `papers` bucket, run the parse-paper
// edge function, then convert the parsed result into an assessment via
// `analysePastPaper` so they can keep editing and run the Coach.

import { useRef, useState } from "react";
import { Loader2, Upload, FileUp, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useNavigate } from "@tanstack/react-router";
import { analysePastPaper } from "@/lib/analyse-past-paper";
import { toast } from "sonner";

type Phase = "idle" | "uploading" | "parsing" | "analysing" | "done" | "failed";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  uploading: "Uploading PDF…",
  parsing: "Reading the PDF and extracting questions, sub-parts and diagrams…",
  analysing: "Tagging Assessment Objectives and Learning Outcomes, building the TOS…",
  done: "Done",
  failed: "Something went wrong",
};

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000;

export function BuilderUploadCard({
  defaultSubject,
  defaultLevel,
}: {
  defaultSubject?: string;
  defaultLevel?: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>(defaultSubject || SUBJECTS[0]);
  const [level, setLevel] = useState<string>(defaultLevel || "Sec 4");
  const [year, setYear] = useState<string>(String(new Date().getFullYear() - 1));
  const [paperNumber, setPaperNumber] = useState<string>("1");
  const [examBoard, setExamBoard] = useState<string>("MOE");
  const [file, setFile] = useState<File | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);

  const busy = phase === "uploading" || phase === "parsing" || phase === "analysing";

  const reset = () => {
    setPhase("idle");
    setErrorMsg(null);
  };

  // Poll past_papers.parse_status until ready or failed (or timeout).
  const waitForParse = async (id: string): Promise<"ready" | "failed" | "timeout"> => {
    const started = Date.now();
    while (Date.now() - started < POLL_MAX_MS) {
      const { data, error } = await supabase
        .from("past_papers")
        .select("parse_status, parse_error")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const status = (data?.parse_status ?? "pending") as string;
      if (status === "ready") return "ready";
      if (status === "failed") {
        setErrorMsg((data as { parse_error?: string | null } | null)?.parse_error ?? "Parsing failed");
        return "failed";
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return "timeout";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error("Please sign in to upload a paper");
      return;
    }
    if (!file) {
      toast.error("Pick a PDF first");
      return;
    }
    if (!title.trim()) {
      toast.error("Give the paper a title");
      return;
    }

    setErrorMsg(null);
    setPhase("uploading");

    try {
      // 1. Upload to papers bucket.
      const ext = file.name.split(".").pop() || "pdf";
      const key = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("papers").upload(key, file, {
        contentType: file.type || "application/pdf",
        upsert: false,
      });
      if (up.error) throw new Error(up.error.message);

      // 2. Insert past_papers row.
      const { data: inserted, error: iErr } = await supabase
        .from("past_papers")
        .insert({
          user_id: user.id,
          title: title.trim(),
          subject,
          level,
          year: Number(year) || null,
          paper_number: paperNumber || null,
          exam_board: examBoard,
          file_path: key,
          parse_status: "pending",
        })
        .select("id")
        .single();
      if (iErr || !inserted) throw new Error(iErr?.message ?? "Could not save paper record");
      const newPaperId = (inserted as { id: string }).id;
      setPaperId(newPaperId);

      // 3. Kick off parse-paper and poll for completion.
      setPhase("parsing");
      supabase.functions
        .invoke("parse-paper", { body: { paperId: newPaperId } })
        .catch((err) => console.warn("parse-paper invoke error", err));

      const parseResult = await waitForParse(newPaperId);
      if (parseResult === "failed") {
        setPhase("failed");
        return;
      }
      if (parseResult === "timeout") {
        setPhase("failed");
        setErrorMsg(
          "Parsing is taking longer than expected. The paper is saved — you can continue from the Past Papers page once it finishes.",
        );
        return;
      }

      // 4. Convert parsed paper into an assessment.
      setPhase("analysing");
      const assessmentId = await analysePastPaper({ paperId: newPaperId, userId: user.id });

      setPhase("done");
      toast.success("Paper imported — opening it in the editor");
      navigate({ to: "/assessment/$id", params: { id: assessmentId } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("failed");
      toast.error(msg);
    }
  };

  const retryParse = async () => {
    if (!paperId) return;
    setErrorMsg(null);
    setPhase("parsing");
    try {
      await supabase
        .from("past_papers")
        .update({ parse_status: "pending", parse_error: null })
        .eq("id", paperId);
      await supabase.functions.invoke("parse-paper", { body: { paperId } });
      const result = await waitForParse(paperId);
      if (result !== "ready") {
        setPhase("failed");
        return;
      }
      if (!user) return;
      setPhase("analysing");
      const assessmentId = await analysePastPaper({ paperId, userId: user.id });
      setPhase("done");
      navigate({ to: "/assessment/$id", params: { id: assessmentId } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("failed");
    }
  };

  if (busy || phase === "done") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary" />
          <div className="flex-1 space-y-2">
            <h2 className="font-paper text-lg font-semibold">Importing your paper</h2>
            <ProgressStep done={phase !== "uploading"} active={phase === "uploading"} label="Upload PDF" />
            <ProgressStep
              done={phase === "analysing" || phase === "done"}
              active={phase === "parsing"}
              label="Parse questions, sub-parts, diagrams"
            />
            <ProgressStep done={phase === "done"} active={phase === "analysing"} label="Build TOS and tag AOs/LOs" />
            <p className="pt-2 text-xs italic text-muted-foreground">
              {PHASE_LABEL[phase]} This usually takes 30–90 seconds — the parse continues even if you navigate away.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div className="flex-1 space-y-3">
            <h2 className="font-paper text-lg font-semibold">We couldn't finish importing this paper</h2>
            <p className="text-sm text-muted-foreground">
              {errorMsg ?? "Something went wrong while parsing the PDF."}
            </p>
            <div className="flex flex-wrap gap-2">
              {paperId && (
                <Button onClick={retryParse} className="gap-1.5">
                  <RefreshCw className="h-4 w-4" /> Try parsing again
                </Button>
              )}
              <Button variant="outline" onClick={reset}>
                Upload a different file
              </Button>
            </div>
            <p className="text-xs italic text-muted-foreground">
              The paper itself is saved — you can also pick it up later from the Past Papers page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 sm:p-8 space-y-5">
      <div className="flex items-start gap-3">
        <FileUp className="mt-0.5 h-5 w-5 text-primary" />
        <div>
          <h2 className="font-paper text-xl font-semibold">Upload an existing paper</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop a PDF — complete or in-progress. We'll parse it, build the Table of Specifications, and open it in
            the editor so you can keep setting and run the Assessment Coach.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="up-title">Title</Label>
        <Input
          id="up-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. 2024 Sec 3 Express History — Mid-Year Paper 1 (draft)"
        />
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
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Year</Label>
          <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Paper number</Label>
          <Input value={paperNumber} onChange={(e) => setPaperNumber(e.target.value)} placeholder="1" />
        </div>
        <div className="space-y-2">
          <Label>Exam board</Label>
          <Input value={examBoard} onChange={(e) => setExamBoard(e.target.value)} placeholder="MOE" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>PDF file</Label>
        <Input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground">
          Tip: include any draft questions you've already written — incomplete papers are fine.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" className="gap-1.5">
          <Upload className="h-4 w-4" /> Upload &amp; analyse
        </Button>
      </div>
    </form>
  );
}

function ProgressStep({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
          done
            ? "bg-success text-success-foreground"
            : active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? "✓" : active ? "…" : ""}
      </span>
      <span className={done || active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
