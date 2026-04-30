import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, Library, FileText, ImageIcon, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { SUBJECTS, LEVELS } from "@/lib/syllabus";

export const Route = createFileRoute("/bank")({
  component: BankPage,
  head: () => ({ meta: [{ title: "Question bank · origAImi" }] }),
});

type Item = {
  id: string;
  subject: string;
  level: string;
  topic: string | null;
  topic_code: string | null;
  bloom_level: string | null;
  difficulty: string | null;
  question_type: string;
  marks: number;
  stem: string;
  source: string;
  tags: string[] | null;
  past_paper_id: string | null;
  question_number: string | null;
  command_word: string | null;
  source_excerpt: string | null;
  diagram_paths: string[] | null;
  learning_outcomes: string[] | null;
  knowledge_outcomes: string[] | null;
  ao_codes: string[] | null;
  syllabus_doc_id: string | null;
  year: number | null;
  paper_number: string | null;
  exam_board: string | null;
  created_at: string;
};

type PaperLite = { id: string; title: string };

function BankPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [papers, setPapers] = useState<Record<string, PaperLite>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterTopic, setFilterTopic] = useState<string>("all");
  const [filterAO, setFilterAO] = useState<string>("all");
  const [filterCommand, setFilterCommand] = useState<string>("all");
  const [filterPaperId, setFilterPaperId] = useState<string>(
    () => new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("paper") ?? "all",
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: itemRows }, { data: paperRows }] = await Promise.all([
        supabase
          .from("question_bank_items")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase.from("past_papers").select("id,title").limit(500),
      ]);
      setItems((itemRows as Item[]) ?? []);
      const map: Record<string, PaperLite> = {};
      ((paperRows as PaperLite[]) ?? []).forEach((p) => { map[p.id] = p; });
      setPapers(map);
      setLoading(false);
    })();
  }, []);

  const topicOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => {
      if (i.topic_code) s.add(i.topic_code);
      else if (i.topic) s.add(i.topic);
    });
    return Array.from(s).sort();
  }, [items]);

  const aoOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => (i.ao_codes ?? []).forEach((a) => s.add(a)));
    return Array.from(s).sort();
  }, [items]);

  const commandOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.command_word) s.add(i.command_word); });
    return Array.from(s).sort();
  }, [items]);

  const filtered = items.filter((i) => {
    if (filterSubject !== "all" && i.subject !== filterSubject) return false;
    if (filterLevel !== "all" && i.level !== filterLevel) return false;
    if (filterSource !== "all" && i.source !== filterSource) return false;
    if (filterTopic !== "all" && (i.topic_code ?? i.topic) !== filterTopic) return false;
    if (filterAO !== "all" && !(i.ao_codes ?? []).includes(filterAO)) return false;
    if (filterCommand !== "all" && i.command_word !== filterCommand) return false;
    if (filterPaperId !== "all" && i.past_paper_id !== filterPaperId) return false;
    if (search.trim()) {
      const hay = `${i.stem} ${i.topic ?? ""} ${i.topic_code ?? ""} ${i.source_excerpt ?? ""} ${(i.learning_outcomes ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const counts = {
    all: items.length,
    past_paper: items.filter((i) => i.source === "past_paper").length,
    ai: items.filter((i) => i.source === "ai").length,
    mine: items.filter((i) => i.source === "mine").length,
  };

  const clearFilters = () => {
    setSearch(""); setFilterSubject("all"); setFilterLevel("all");
    setFilterSource("all"); setFilterTopic("all"); setFilterAO("all");
    setFilterCommand("all"); setFilterPaperId("all");
  };

  const activePaperTitle = filterPaperId !== "all" ? papers[filterPaperId]?.title : null;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-primary">Question bank</p>
            <h1 className="mt-1 font-paper text-3xl font-semibold tracking-tight">Question bank</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Searchable repository of items extracted from your uploaded papers — fully tagged by topic, learning outcome, and assessment objective.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{counts.all}</strong> total</span>
            <span><strong className="text-foreground">{counts.past_paper}</strong> from papers</span>
            <span><strong className="text-foreground">{counts.ai}</strong> AI</span>
          </div>
        </div>

        {activePaperTitle && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-xs">
            <FileText className="h-3.5 w-3.5 text-primary" />
            <span>Showing items from <strong>{activePaperTitle}</strong></span>
            <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-xs" onClick={() => setFilterPaperId("all")}>
              <X className="h-3 w-3" /> Clear
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="mt-5 grid gap-3 rounded-xl border border-border bg-card/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stem, topic, source excerpt, or learning outcome…"
              className="pl-9"
            />
          </div>

          <FilterSelect label="Subject" value={filterSubject} onChange={setFilterSubject}
            options={[["all", "All subjects"], ...SUBJECTS.map((s) => [s, s] as [string, string])]} />
          <FilterSelect label="Level" value={filterLevel} onChange={setFilterLevel}
            options={[["all", "All levels"], ...LEVELS.map((l) => [l, l] as [string, string])]} />
          <FilterSelect label="Source" value={filterSource} onChange={setFilterSource}
            options={[
              ["all", "Any source"],
              ["past_paper", "From past papers"],
              ["ai", "AI-generated"],
              ["mine", "My own"],
            ]} />
          <FilterSelect label="Topic / KO" value={filterTopic} onChange={setFilterTopic}
            options={[["all", "Any topic"], ...topicOptions.map((t) => [t, t] as [string, string])]} />
          <FilterSelect label="Assessment Objective" value={filterAO} onChange={setFilterAO}
            options={[["all", "Any AO"], ...aoOptions.map((a) => [a, a] as [string, string])]} />
          <FilterSelect label="Command word" value={filterCommand} onChange={setFilterCommand}
            options={[["all", "Any command"], ...commandOptions.map((c) => [c, c] as [string, string])]} />

          <div className="flex items-end justify-end">
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          </div>
        </div>

        {/* Results */}
        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading bank…</p>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Library className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-medium">
                {items.length === 0 ? "Bank is empty" : "No items match"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {items.length === 0 ? (
                  <>Upload a past paper on the <Link to="/papers" className="text-primary underline">Papers</Link> page — questions will be extracted and added here automatically.</>
                ) : "Try clearing some filters."}
              </p>
            </div>
          ) : (
            filtered.map((i) => (
              <BankCard key={i.id} item={i} paper={i.past_paper_id ? papers[i.past_paper_id] : undefined} />
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, lbl]) => <SelectItem key={v} value={v}>{lbl}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function BankCard({ item, paper }: { item: Item; paper?: PaperLite }) {
  const [open, setOpen] = useState(false);
  const [signedUrls, setSignedUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!open || signedUrls.length > 0) return;
    const paths = item.diagram_paths ?? [];
    if (paths.length === 0) return;
    (async () => {
      const urls: string[] = [];
      for (const p of paths) {
        // Skip PDF fallbacks — we can't render those inline.
        if (p.startsWith("papers/")) continue;
        const { data } = await supabase.storage.from("diagrams").createSignedUrl(p, 3600);
        if (data?.signedUrl) urls.push(data.signedUrl);
      }
      setSignedUrls(urls);
    })();
  }, [open, item.diagram_paths, signedUrls.length]);

  const hasAttachments = (item.source_excerpt && item.source_excerpt.length > 0)
    || (item.diagram_paths && item.diagram_paths.length > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{item.subject}</Badge>
        <Badge variant="secondary">{item.level}</Badge>
        {item.source === "past_paper" && (
          <Badge className="bg-primary-soft text-primary hover:bg-primary-soft">Past paper</Badge>
        )}
        {item.source === "ai" && <Badge variant="outline">AI</Badge>}
        {item.question_number && <Badge variant="outline">Q{item.question_number}</Badge>}
        {item.command_word && <Badge variant="outline">{item.command_word}</Badge>}
        {item.bloom_level && <Badge variant="outline">{item.bloom_level}</Badge>}
        {item.difficulty && <Badge variant="outline">{item.difficulty}</Badge>}
        <Badge variant="outline">{item.marks} mark{item.marks === 1 ? "" : "s"}</Badge>
        {item.year && <Badge variant="outline">{item.year}</Badge>}
      </div>

      <p className="mt-3 font-paper text-sm leading-relaxed text-foreground whitespace-pre-wrap">
        {item.stem}
      </p>

      {/* Tagging summary */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {item.topic_code && <span><strong className="text-foreground">Topic:</strong> {item.topic_code}</span>}
        {item.learning_outcomes && item.learning_outcomes.length > 0 && (
          <span><strong className="text-foreground">LO:</strong> {item.learning_outcomes.slice(0, 4).join(", ")}{item.learning_outcomes.length > 4 ? "…" : ""}</span>
        )}
        {item.knowledge_outcomes && item.knowledge_outcomes.length > 0 && (
          <span><strong className="text-foreground">KO:</strong> {item.knowledge_outcomes.slice(0, 3).join(", ")}</span>
        )}
        {item.ao_codes && item.ao_codes.length > 0 && (
          <span><strong className="text-foreground">AO:</strong> {item.ao_codes.join(", ")}</span>
        )}
        {paper && (
          <span><strong className="text-foreground">Source:</strong> {paper.title}{item.paper_number ? ` · P${item.paper_number}` : ""}</span>
        )}
      </div>

      {hasAttachments && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {open ? "Hide" : "Show"} attachments
          {item.diagram_paths && item.diagram_paths.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-muted-foreground">
              <ImageIcon className="h-3 w-3" /> {item.diagram_paths.length}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {item.source_excerpt && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Source / stimulus</p>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-paper text-sm leading-relaxed">
                {item.source_excerpt}
              </p>
            </div>
          )}
          {signedUrls.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Diagrams</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {signedUrls.map((u, idx) => (
                  <img key={idx} src={u} alt="Past paper diagram" className="rounded-md border border-border bg-white" loading="lazy" />
                ))}
              </div>
            </div>
          )}
          {item.diagram_paths && item.diagram_paths.length > 0 && signedUrls.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Diagram references stored, but no inline images available (PDF-only fallback).</p>
          )}
        </div>
      )}
    </div>
  );
}
