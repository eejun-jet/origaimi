import { createFileRoute, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Sparkles,
  Wand2,
  Compass,
  Library,
  Target,
  Eye,
  Waves,
} from "lucide-react";
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
                <a href="#swan">
                  <Button size="lg" variant="outline">
                    The story behind the name
                  </Button>
                </a>
              </div>
              <p className="mt-6 text-xs text-muted-foreground">
                ​
              </p>
            </div>
          </div>
        </section>

        {/* THE SWAN */}
        <section id="swan" className="border-t border-border/60 bg-card/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-paper text-3xl font-semibold tracking-tight sm:text-4xl">
                The swan, and what's underneath.
              </h2>
              <p className="mt-4 text-muted-foreground">
                A beautifully crafted exam paper looks elegant on the surface. What we
                don't see is the relentless paddling underneath — the friction every
                educator knows too well.
              </p>
            </div>

            <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-background p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Eye className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-paper text-xl font-semibold text-foreground">
                  What you see
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  A clean, well-structured paper. Aligned to the syllabus. Balanced
                  Bloom's. Crisp diagrams. Calm and graceful.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-background p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warm text-warm-foreground">
                  <Waves className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-paper text-xl font-semibold text-foreground">
                  What's underneath
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                  <li>· Wrestling with TOS alignments</li>
                  <li>· Sourcing context for diagrams</li>
                  <li>· Hunting for fresh inspiration</li>
                  <li>· Manually checking Assessment Objectives</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* THE PHILOSOPHY */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-paper text-3xl font-semibold tracking-tight sm:text-4xl">
                Why <span>orig<span className="text-primary">AI</span>mi</span>?
              </h2>
              <p className="mt-4 text-muted-foreground">
                The name reflects our philosophy: AI accelerates, but the educator
                stays firmly in the equation, from start to finish.
              </p>
            </div>

            <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
              <NameCard letter="Orig" body="The original intent of the assessment — yours." />
              <NameCard letter="AI" body="The engine that supercharges the workflow." />
              <NameCard letter="mi" body="Me — the educator, always in the loop." />
            </div>
          </div>
        </section>

        {/* FOUR PILLARS */}
        <section className="border-t border-border/60 bg-card/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-paper text-3xl font-semibold tracking-tight sm:text-4xl">
                The engine: four friction points, solved.
              </h2>
              <p className="mt-4 text-muted-foreground">
                origAImi takes over the heavy lifting where it matters most.
              </p>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-2">
              <Pillar
                icon={<Wand2 className="h-5 w-5" />}
                title="Intentional Generation"
                body="Usable, high-quality questions — diagrams included — from simple guided prompts."
              />
              <Pillar
                icon={<Compass className="h-5 w-5" />}
                title="Intelligent Coaching"
                body="An embedded Assessment Literacy Coach that evaluates your paper against AO frameworks and gives actionable insights."
              />
              <Pillar
                icon={<Library className="h-5 w-5" />}
                title="Curated Inspiration"
                body="A meticulously tagged repository of questions for instant inspiration when you're setting papers."
              />
              <Pillar
                icon={<Target className="h-5 w-5" />}
                title="Precision Alignment"
                body="Automated TOS template analysis ensures your final paper aligns perfectly with the original curriculum input."
              />
            </div>
          </div>
        </section>

        {/* CLOSE */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
            <h2 className="font-paper text-3xl font-semibold tracking-tight sm:text-4xl">
              No time? No problem.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Let the AI do the paddling, so our teachers can unfold the joy of
              assessing today.
            </p>
            <div className="mt-8">
              <Link to="/dashboard">
                <Button size="lg" className="gap-2">
                  Set your first paper
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
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

function NameCard({ letter, body }: { letter: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center">
      <div className="font-paper text-4xl font-semibold text-primary">{letter}</div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Pillar({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-6 transition-colors hover:border-primary/40">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
        {icon}
      </div>
      <h3 className="mt-4 font-paper text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
