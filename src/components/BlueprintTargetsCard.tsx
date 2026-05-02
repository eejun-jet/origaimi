// Lets a teacher confirm or override AO weighting targets after importing a
// past paper. The TOS Δ column compares actual marks against these targets,
// so without this step every Δ is zero (target ≈ actual). We persist
// overrides into `assessments.blueprint.ao_overrides` (a code → percent map)
// and a `ao_targets_confirmed` flag the exporter surfaces in its header.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AODefMin = {
  code: string;
  title: string | null;
  weighting_percent: number | null;
};

type Props = {
  assessmentId: string;
  totalMarks: number;
  aoDefs: AODefMin[]; // syllabus-derived defaults
  // Codes seen on questions (so we still let teachers set targets even when
  // syllabus AO defs are missing for the matched code).
  observedAoCodes: string[];
  initialOverrides: Record<string, number> | null;
  initialConfirmed: boolean;
  onSaved: (next: { overrides: Record<string, number>; confirmed: boolean }) => void;
};

export function BlueprintTargetsCard({
  assessmentId,
  totalMarks,
  aoDefs,
  observedAoCodes,
  initialOverrides,
  initialConfirmed,
  onSaved,
}: Props) {
  const codes = useMemo(() => {
    const set = new Set<string>();
    aoDefs.forEach((d) => set.add(d.code));
    observedAoCodes.forEach((c) => set.add(c));
    return Array.from(set).sort();
  }, [aoDefs, observedAoCodes]);

  const defaultFor = (code: string): string => {
    const ov = initialOverrides?.[code];
    if (typeof ov === "number") return String(ov);
    const def = aoDefs.find((d) => d.code === code)?.weighting_percent;
    return typeof def === "number" ? String(def) : "";
  };

  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of codes) out[c] = defaultFor(c);
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(initialConfirmed);

  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev };
      for (const c of codes) if (!(c in next)) next[c] = defaultFor(c);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join("|"), aoDefs.map((d) => d.code + (d.weighting_percent ?? "")).join("|")]);

  const totalPct = codes.reduce((s, c) => s + (Number(values[c]) || 0), 0);
  const totalOff = Math.abs(totalPct - 100) > 0.5 && codes.length > 0;

  const save = async () => {
    if (codes.length === 0) {
      toast.error("No Assessment Objectives detected on this paper yet.");
      return;
    }
    setSaving(true);
    try {
      // Read the current blueprint so we don't clobber sections (imported
      // papers usually have an empty blueprint, but stay safe).
      const { data: cur } = await supabase
        .from("assessments")
        .select("blueprint")
        .eq("id", assessmentId)
        .maybeSingle();
      const base = (cur?.blueprint && typeof cur.blueprint === "object" && !Array.isArray(cur.blueprint))
        ? (cur.blueprint as Record<string, unknown>)
        : {};
      const overrides: Record<string, number> = {};
      for (const c of codes) {
        const n = Number(values[c]);
        if (!Number.isNaN(n) && n > 0) overrides[c] = Math.round(n * 10) / 10;
      }
      const next = { ...base, ao_overrides: overrides, ao_targets_confirmed: true };

      const { error } = await supabase
        .from("assessments")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ blueprint: next as any })
        .eq("id", assessmentId);
      if (error) throw new Error(error.message);

      setConfirmed(true);
      onSaved({ overrides, confirmed: true });
      toast.success("AO targets saved — TOS will compare against these.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save targets");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-primary-soft/40 p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1 space-y-1">
          <h3 className="text-sm font-semibold">
            {confirmed ? "AO targets confirmed" : "Confirm AO blueprint targets"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {confirmed
              ? "These targets are used by the Coverage panel and the downloaded TOS. Edit any value to adjust."
              : "We pre-filled syllabus weightings where we found a match. Adjust to your school's blueprint so the TOS Δ column reflects real over- or under-testing."}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {codes.length === 0 && (
          <p className="text-xs italic text-muted-foreground">
            No Assessment Objectives have been detected yet — re-tag questions or wait for parsing to complete.
          </p>
        )}
        {codes.map((code) => {
          const def = aoDefs.find((d) => d.code === code);
          const pct = Number(values[code]) || 0;
          const targetMarks = Math.round((pct / 100) * totalMarks);
          return (
            <div
              key={code}
              className="grid grid-cols-[3rem,minmax(0,1fr),auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[3rem,minmax(0,1fr),5rem,4rem]"
            >
              <span className="text-xs font-semibold text-foreground">{code}</span>
              <span
                className="col-span-2 truncate text-xs text-muted-foreground sm:col-span-1"
                title={def?.title ?? ""}
              >
                {def?.title ?? "—"}
              </span>
              <div className="col-start-2 flex items-center gap-1 sm:col-start-3">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={values[code] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))}
                  className="h-8 px-2 text-xs"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <span className="text-right text-[11px] text-muted-foreground">≈ {targetMarks} m</span>
            </div>
          );
        })}
      </div>

      {codes.length > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
          <Label className="text-xs text-muted-foreground">
            Total: <span className={totalOff ? "text-amber-600" : "text-foreground"}>{totalPct}%</span>
            {totalOff && <span className="ml-1 italic">(should add up to ~100%)</span>}
          </Label>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {confirmed ? "Update targets" : "Save targets"}
          </Button>
        </div>
      )}
    </div>
  );
}
