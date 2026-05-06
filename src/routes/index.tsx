import { createFileRoute, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import heroBanner from "@/assets/hero-banner.jpg";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "origAImi — Unfold the Joy of Assessing" },
      {
        name: "description",
        content:
          "origAImi is the AI co-architect for Singapore educators. Effortless generation, intelligent coaching, curated inspiration, precision alignment — human-in-the-loop, from start to finish.",
      },
      { property: "og:title", content: "origAImi — Unfold the Joy of Assessing" },
      {
        property: "og:description",
        content:
          "AI does the paddling. You set the course. Set exam papers faster, better, and fully aligned with your Assessment Literacy framework.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
            <div className="mx-auto max-w-3xl text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Human-in-the-loop AI for Singapore educators
              </div>
            </div>
            <h1 className="sr-only">origAImi — Unfold the Joy of Assessing</h1>
            <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <img
                src={heroBanner}
                alt="origAImi — Unfold the Joy of Assessing, with an origami swan"
                className="h-auto w-full"
                loading="eager"
                fetchPriority="high"
              />
            </div>
            <div className="mx-auto max-w-3xl text-center">
              <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                AI does the paddling. You set the course. origAImi takes over the heavy
                lifting of assessment design — so educators can focus on what only they
                can do.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link to="/dashboard">
                  <Button size="lg" className="gap-2">
                    Start setting
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} origAImi · For Singapore educators
        </div>
      </footer>
    </div>
  );
}
