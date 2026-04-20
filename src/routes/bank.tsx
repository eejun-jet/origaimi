import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Library } from "lucide-react";

export const Route = createFileRoute("/bank")({
  component: BankPage,
  head: () => ({ meta: [{ title: "Curated Inspiration · Origaimi" }] }),
});

type Item = {
  id: string;
  subject: string;
  level: string;
  topic: string | null;
  bloom_level: string | null;
  difficulty: string | null;
  question_type: string;
  marks: number;
  stem: string;
  source: string;
};

function BankPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase
      .from("question_bank_items")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setItems((data as Item[]) ?? []));
  }, []);

  const filtered = items.filter((i) =>
    !search || i.stem.toLowerCase().includes(search.toLowerCase()) ||
    i.topic?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-primary">Curated Inspiration</p>
          <h1 className="mt-1 font-paper text-3xl font-semibold tracking-tight">Question bank</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A meticulously tagged repository for instant inspiration when you're setting papers.
          </p>
        </div>

        <div className="relative mt-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by topic or text..."
            className="pl-9"
          />
        </div>

        <div className="mt-6 space-y-3">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Library className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-medium">Bank is empty</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Save items from any assessment to reuse later.
              </p>
            </div>
          ) : (
            filtered.map((i) => (
              <div key={i.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{i.subject}</Badge>
                  <Badge variant="secondary">{i.level}</Badge>
                  {i.topic && <Badge variant="outline">{i.topic}</Badge>}
                  {i.bloom_level && <Badge variant="outline">{i.bloom_level}</Badge>}
                  {i.difficulty && <Badge variant="outline">{i.difficulty}</Badge>}
                  <Badge variant="outline">{i.marks} mark{i.marks > 1 ? "s" : ""}</Badge>
                </div>
                <p className="mt-3 font-paper text-sm leading-relaxed text-foreground">{i.stem}</p>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
