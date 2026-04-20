import { Link } from "@tanstack/react-router";
import logo from "@/assets/origaimi-logo.png";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <img src={logo} alt="Origaimi" className="h-7 w-7 object-contain" />
          <span>Origaimi</span>
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            to="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            Assessments
          </Link>
          <Link
            to="/bank"
            className="text-sm text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            Inspiration
          </Link>
          <Link
            to="/admin/syllabus"
            className="text-sm text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            Syllabi
          </Link>
          <span className="hidden rounded-full border border-primary/30 bg-primary-soft px-2 py-0.5 text-xs text-primary sm:inline-block">
            Free trial
          </span>
        </nav>
      </div>
    </header>
  );
}
