// Pre-generation Assessment Intent Coach panel.
//
// Sits beside the assessment builder on steps 2–4. Shows at most two
// observations at a time. An optional "Get Coach review" button calls the
// `coach-intent` edge function for an AI pass when the teacher wants more.

import { useMemo, useState } from "react";
import { Sparkles, Loader2, X, Wand2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export function BuilderCoachPanel({
  snapshot,
  onAppendInstructions,
}: {
  snapshot: BuilderSnapshot;
  onAppendInstructions: (text: string) => void;
}) {
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
        <Button size="sm" variant="outline" onClick={runCoach} disabled={running} className="h-7 gap-1.5 text-xs">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          {running ? "Reviewing…" : aiReview ? "Re-run" : "Ask Coach"}
        </Button>
      </div>

      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
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
    </div>
  );
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
