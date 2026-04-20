import { createFileRoute, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, Layers, Sparkles, BookOpen, Wand2, Library } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Joy of Assessment — AI assessment platform for Singapore teachers" },
      {
        name: "description",
        content:
          "Reclaim hours every week. A blueprint-first AI co-architect for Singapore teachers — draft MOE-aligned papers, then refine with your pedagogical expertise.",
      },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main>
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Built for Singapore teachers
              </div>
              <h1 className="mt-6 font-paper text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-6xl">
                The joy of assessment,<br />
                <span className="text-primary">restored.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Define the blueprint. Let AI draft a syllabus-aligned paper. Then add what only
                you can — your pedagogical expertise. Reclaim hours. Become an assessment architect.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link to="/dashboard">
                  <Button size="lg" className="gap-2">
                    Start creating
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <a href="#how">
                  <Button size="lg" variant="outline">See how it works</Button>
                </a>
              </div>
              <p className="mt-6 text-xs text-muted-foreground">
                Free trial · No sign-in required · MOE-aligned · P1–Sec 4
              </p>
            </div>

            {/* Stats */}
            <div className="mx-auto mt-20 grid max-w-4xl gap-6 sm:grid-cols-3">
              <Stat value="35,000" label="Singapore teachers" />
              <Stat value="735,000" label="hours reclaimable / year" />
              <Stat value="6 steps" label="from blueprint to paper" />
            </div>
          </div>
        </section>

        <section id="how" className="border-t border-border/60 bg-card/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-paper text-3xl font-semibold tracking-tight sm:text-4xl">
                Blueprint first. AI second. You always in charge.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Most AI tools generate first, then ask you to fix the mess. We flip it.
                You shape the assessment specification — topics, Bloom's distribution, marks,
                question types — and the AI works to it.
              </p>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-3">
              <Feature
                icon={<Layers className="h-5 w-5" />}
                title="1. Design the blueprint"
                body="Pick subject, level, topics, Bloom's mix and marks. The AI proposes a starting matrix; you tweak until it's right."
              />
              <Feature
                icon={<Wand2 className="h-5 w-5" />}
                title="2. Generate a draft"
                body="AI writes the full paper to your spec — MOE phrasing, SI units, Singapore contexts, structured mark schemes."
              />
              <Feature
                icon={<BookOpen className="h-5 w-5" />}
                title="3. Architect, don't author"
                body="Regenerate single questions, swap from your bank, edit inline, override Bloom's. The blueprint meter keeps you on track."
              />
              <Feature
                icon={<Library className="h-5 w-5" />}
                title="Reusable question bank"
                body="Approve great items once and pull them into any future paper with a click."
              />
              <Feature
                icon={<Clock className="h-5 w-5" />}
                title="Hours back, every week"
                body="What used to take half a day now takes thirty thoughtful minutes."
              />
              <Feature
                icon={<Sparkles className="h-5 w-5" />}
                title="Print-ready exports"
                body="Student paper and mark scheme as PDF and DOCX, ready for the photocopier."
              />
            </div>
          </div>
        </section>

        <section className="border-t border-border/60">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
            <h2 className="font-paper text-3xl font-semibold tracking-tight sm:text-4xl">
              Spend your time on what matters most.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Teaching. Mentoring. Growing. Not formatting tables and counting marks.
            </p>
            <div className="mt-8">
              <Link to="/dashboard">
                <Button size="lg" className="gap-2">
                  Create your first assessment
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} Joy of Assessment · For Singapore teachers
        </div>
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center">
      <div className="font-paper text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
