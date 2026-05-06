// Pre-generation Assessment Intent Coach panel.
//
// Two modes inside one panel:
//   - Review: deterministic + AI one-shot review (existing behaviour).
//   - Chat: free-form conversation grounded in the same builder snapshot.

import { useMemo, useRef, useState, useEffect } from "react";
import {
  Sparkles, Loader2, X, Wand2, ChevronDown, ChevronUp,
  MessageSquare, Send, Eraser,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  computeIntentSignals,
  snapshotForAI,
  type BuilderSnapshot,
  type IntentSignal,
} from "@/lib/intent-coach";

type AIObservation = {
  severity: "info" | "warn";
  category: IntentSignal["category"];
  note: string;
};
type AISuggestion = {
  rewrite: string;
  rationale?: string;
  target: "instructions" | "sections" | "general";
};
type AIReview = {
  summary?: string;
  observations: AIObservation[];
  suggestions: AISuggestion[];
};

type ChatMsg = { role: "user" | "assistant"; content: string };
type Mode = "review" | "chat";

export function BuilderCoachPanel({
  snapshot,
  onAppendInstructions,
  stage = "pre",
  assessmentId,
}: {
  snapshot: BuilderSnapshot;
  onAppendInstructions: (text: string) => void;
  stage?: "pre" | "post";
  assessmentId?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("review");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [running, setRunning] = useState(false);
  const [aiReview, setAiReview] = useState<AIReview | null>(null);

  const localSignals = useMemo(() => computeIntentSignals(snapshot), [snapshot]);
  const visibleLocal = localSignals.filter((s) => !dismissed.has(s.id));
  const aiObservations = aiReview?.observations ?? [];
  const aiSuggestions = aiReview?.suggestions ?? [];

  const totalCards = visibleLocal.length + aiObservations.length;
  const collapsedLimit = 2;
  const shownLocal = showAll ? visibleLocal : visibleLocal.slice(0, collapsedLimit);
  const remainingForAi = showAll ? aiObservations : aiObservations.slice(0, Math.max(0, collapsedLimit - shownLocal.length));

  const runCoach = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("coach-intent", {
        body: snapshotForAI(snapshot),
      });
      if (error) throw new Error(error.message || "Coach failed");
      const review = (data?.findings ?? data) as AIReview | undefined;
      if (!review || !Array.isArray(review.observations)) {
        throw new Error("Coach returned no observations");
      }
      setAiReview(review);
      if (review.observations.length === 0 && review.suggestions.length === 0) {
        toast.success("Coach: looks solid — nothing to flag.");
      } else {
        toast.success("Coach review ready");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Coach failed";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Assessment Coach</h3>
        </div>
        {mode === "review" ? (
          <Button size="sm" variant="outline" onClick={runCoach} disabled={running} className="h-7 gap-1.5 text-xs">
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            {running ? "Reviewing…" : aiReview ? "Re-run" : "Ask Coach"}
          </Button>
        ) : null}
      </div>

      {/* Mode tabs */}
      <div className="mt-3 inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode("review")}
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            mode === "review" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Wand2 className="h-3 w-3" /> Review
        </button>
        <button
          type="button"
          onClick={() => setMode("chat")}
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            mode === "chat" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-3 w-3" /> Chat
        </button>
      </div>

      {mode === "review" && (
        <>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Optional, sparse nudges. Apply, dismiss, or ignore — your call.
          </p>

          <div className="mt-3 space-y-2">
            {totalCards === 0 && !aiReview && (
              <p className="text-xs italic text-muted-foreground">No notes — looking good.</p>
            )}

            {aiReview?.summary && (
              <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
                {aiReview.summary}
              </div>
            )}

            {shownLocal.map((s) => (
              <SignalCard
                key={s.id}
                severity={s.severity}
                category={s.category}
                note={s.note}
                applyLabel={s.applyToInstructions ? "Apply to instructions" : undefined}
                onApply={s.applyToInstructions ? () => onAppendInstructions(s.applyToInstructions!) : undefined}
                onDismiss={() => setDismissed((prev) => new Set(prev).add(s.id))}
              />
            ))}

            {remainingForAi.map((o, i) => (
              <SignalCard
                key={`ai-obs-${i}`}
                severity={o.severity}
                category={o.category}
                note={o.note}
              />
            ))}

            {totalCards > collapsedLimit && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showAll ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAll ? "Show fewer" : `Show ${totalCards - collapsedLimit} more`}
              </button>
            )}

            {aiSuggestions.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Suggestions
                </p>
                {aiSuggestions.map((s, i) => (
                  <div key={`ai-sug-${i}`} className="rounded-md border border-border bg-card p-2.5">
                    <p className="text-xs">{s.rewrite}</p>
                    {s.rationale && (
                      <p className="mt-1 text-[10px] italic text-muted-foreground">{s.rationale}</p>
                    )}
                    {s.target === "instructions" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-6 gap-1 text-[10px]"
                        onClick={() => {
                          onAppendInstructions(s.rewrite);
                          toast.success("Added to special instructions");
                        }}
                      >
                        Apply to instructions
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {snapshot.step === 4 && !aiReview && !running && (
            <p className="mt-3 text-[11px] italic text-muted-foreground">
              Tip: ask the Coach once before generating — it's a 5-second sanity check.
            </p>
          )}
        </>
      )}

      {mode === "chat" && (
        <CoachChat
          snapshot={snapshot}
          stage={stage}
          assessmentId={assessmentId ?? null}
          onAppendInstructions={onAppendInstructions}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Chat
// ────────────────────────────────────────────────────────────────────────────

const STARTER_PROMPTS_PRE = [
  "Is the AO mix balanced for this paper?",
  "Suggest a transfer context for one section.",
  "How can I push this beyond recall?",
];
const STARTER_PROMPTS_POST = [
  "Which question feels weakest, and why?",
  "Suggest a harder variant of one question.",
  "Spot any AO/LO drift in the draft.",
];

function CoachChat({
  snapshot,
  stage,
  assessmentId,
  onAppendInstructions,
}: {
  snapshot: BuilderSnapshot;
  stage: "pre" | "post";
  assessmentId: string | null;
  onAppendInstructions: (text: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const starters = stage === "post" ? STARTER_PROMPTS_POST : STARTER_PROMPTS_PRE;

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/coach-chat`;
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      };
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const resp = await fetch(url, {
        method: "POST",
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({
          stage,
          snapshot: snapshotForAI(snapshot),
          assessment_id: assessmentId,
          messages: next,
        }),
      });

      if (!resp.ok || !resp.body) {
        let msg = "Coach chat failed";
        try {
          const j = await resp.json();
          if (j?.error) msg = j.error;
        } catch { /* ignore */ }
        if (resp.status === 429) msg = "Rate limit reached. Try again in a minute.";
        if (resp.status === 402) msg = "AI credits exhausted. Top up to continue.";
        throw new Error(msg);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { done: rDone, value } = await reader.read();
        if (rDone) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(payload);
            const delta: string | undefined = parsed.choices?.[0]?.delta?.content;
            if (delta) upsertAssistant(delta);
          } catch {
            // partial JSON; put back and wait
            buf = line + "\n" + buf;
            break;
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Coach chat failed";
      toast.error(msg);
      // remove the trailing empty assistant if any
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const clear = () => {
    if (busy) abortRef.current?.abort();
    setMessages([]);
  };

  return (
    <div className="mt-3 flex flex-col">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Ask anything about this paper. Replies are short and grounded in your selections.</span>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <Eraser className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="mt-2 max-h-[360px] min-h-[120px] space-y-2 overflow-y-auto rounded-md border border-border bg-muted/20 p-2"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-1.5 p-1">
            <p className="text-[11px] italic text-muted-foreground">Try:</p>
            {starters.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-left text-[11px] hover:bg-accent"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <ChatBubble
              key={i}
              role={m.role}
              content={m.content}
              onApply={stage === "pre" ? onAppendInstructions : undefined}
            />
          ))
        )}
        {busy && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Coach is thinking…
          </div>
        )}
      </div>

      <div className="mt-2 flex items-end gap-1.5">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={busy ? "Waiting for reply…" : "Ask the Coach…"}
          disabled={busy}
          rows={2}
          className="min-h-[40px] resize-none text-xs"
        />
        <Button
          size="sm"
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          className="h-9 gap-1 text-xs"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Send
        </Button>
      </div>
    </div>
  );
}

// Render chat content with simple paragraph/list handling and pluck out
// ```instruction blocks so the teacher can apply them in one click.
function ChatBubble({
  role,
  content,
  onApply,
}: {
  role: "user" | "assistant";
  content: string;
  onApply?: (text: string) => void;
}) {
  const isUser = role === "user";
  const parts = useMemo(() => splitInstructionBlocks(content), [content]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-md px-2.5 py-1.5 text-xs leading-relaxed ${
          isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border"
        }`}
      >
        {parts.map((p, i) =>
          p.type === "instruction" ? (
            <div key={i} className="my-1.5 rounded border border-dashed border-primary/40 bg-primary/5 p-2 text-foreground">
              <p className="text-[11px] font-medium uppercase tracking-wide text-primary">Suggested instruction</p>
              <p className="mt-1 whitespace-pre-wrap text-xs">{p.text}</p>
              {onApply && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1.5 h-6 gap-1 text-[10px]"
                  onClick={() => {
                    onApply(p.text);
                    toast.success("Added to special instructions");
                  }}
                >
                  Apply to instructions
                </Button>
              )}
            </div>
          ) : (
            <span key={i} className="whitespace-pre-wrap">{p.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

function splitInstructionBlocks(content: string): Array<{ type: "text" | "instruction"; text: string }> {
  const out: Array<{ type: "text" | "instruction"; text: string }> = [];
  const re = /```instruction\s*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push({ type: "text", text: content.slice(last, m.index) });
    out.push({ type: "instruction", text: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ type: "text", text: content.slice(last) });
  if (out.length === 0) out.push({ type: "text", text: content });
  return out;
}

function SignalCard({
  severity,
  category,
  note,
  applyLabel,
  onApply,
  onDismiss,
}: {
  severity: "info" | "warn";
  category: IntentSignal["category"];
  note: string;
  applyLabel?: string;
  onApply?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            severity === "warn" ? "bg-warm" : "bg-muted-foreground/60"
          }`}
          aria-hidden
        />
        <div className="flex-1">
          <p className="text-xs leading-snug">{note}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant="outline" className="h-4 px-1 text-[9px] capitalize">
              {category.replace(/_/g, " ")}
            </Badge>
            {onApply && applyLabel && (
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={onApply}>
                {applyLabel}
              </Button>
            )}
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
