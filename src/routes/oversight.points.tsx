import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Printer } from "lucide-react";
import { useRoles } from "@/lib/roles";

export const Route = createFileRoute("/oversight/points")({
  component: PointsPage,
  head: () => ({ meta: [{ title: "Points leaderboard · origAImi" }] }),
});

type Row = {
  teacher_key: string;
  teacher_name: string | null;
  year: number | null;
  department: string | null;
  setting_points: number;
  marking_points: number;
  moderation_points: number;
  total_points: number;
};

function PointsPage() {
  const { canSeeOversight } = useRoles();
  const [rows, setRows] = useState<Row[]>([]);
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("teacher_points_year" as never).select("*");
      setRows(((data ?? []) as unknown as Row[]).map((r) => ({
        ...r,
        setting_points: Number(r.setting_points) || 0,
        marking_points: Number(r.marking_points) || 0,
        moderation_points: Number(r.moderation_points) || 0,
        total_points: Number(r.total_points) || 0,
      })));
    })();
  }, []);

  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => r.year).filter((x): x is number => x != null))).sort((a, b) => b - a),
    [rows],
  );

  const filtered = useMemo(() => {
    const merged = new Map<string, Row>();
    for (const r of rows) {
      if (year !== "all" && String(r.year ?? "") !== year) continue;
      const key = r.teacher_name ?? r.teacher_key;
      const e = merged.get(key) ?? {
        teacher_key: r.teacher_key,
        teacher_name: r.teacher_name,
        year: r.year,
        department: r.department,
        setting_points: 0,
        marking_points: 0,
        moderation_points: 0,
        total_points: 0,
      };
      e.setting_points += r.setting_points;
      e.marking_points += r.marking_points;
      e.moderation_points += r.moderation_points;
      e.total_points += r.total_points;
      merged.set(key, e);
    }
    return Array.from(merged.values()).sort((a, b) => b.total_points - a.total_points);
  }, [rows, year]);

  if (!canSeeOversight) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-12">
          <Card><CardHeader><CardTitle>Points leaderboard</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              This area is for HODs and School Leaders.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const totalSetting = filtered.reduce((a, r) => a + r.setting_points, 0);
  const totalMarking = filtered.reduce((a, r) => a + r.marking_points, 0);
  const totalMod = filtered.reduce((a, r) => a + r.moderation_points, 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden"><AppHeader /></div>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/oversight"><ArrowLeft className="mr-1 h-4 w-4" /> Back to oversight</Link>
          </Button>
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => window.print()} size="sm">
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setters · Markers · Moderators — Points leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            {year === "all" ? "All years" : `Year ${year}`} · Setting + Marking + Moderation contributions
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Setting</TableHead>
                  <TableHead className="text-right">Marking</TableHead>
                  <TableHead className="text-right">Moderation</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="p-8 text-center text-sm text-muted-foreground">No data yet — import a deployment sheet first.</TableCell></TableRow>
                ) : filtered.map((r, i) => (
                  <TableRow key={r.teacher_key + (r.year ?? "")}>
                    <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{r.teacher_name ?? r.teacher_key}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.department ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.setting_points.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.marking_points.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.moderation_points.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{r.total_points.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {filtered.length > 0 && (
                <tfoot className="border-t bg-muted/30">
                  <tr className="text-sm">
                    <td colSpan={3} className="px-4 py-2 font-medium">Totals</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totalSetting.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totalMarking.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totalMod.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">
                      {(totalSetting + totalMarking + totalMod).toFixed(1)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground print:block">
          Defaults: G3/Express full paper = 2 · G2 variant = 1 · G2 standalone = 1.5 · G1/NT = 1 ·
          WA = 1 · MYE = 1.5 · EoY/Prelim = 2. Marking = 0.25 per class + 0.02 per script.
          Moderation = 0.5 per paper. Co-setters / co-markers split points.
        </p>
      </main>
    </div>
  );
}
