import { Link } from "@tanstack/react-router";
import logo from "@/assets/hero-banner.jpg";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <img src={logo} alt="origAImi" className="h-9 object-contain" />
          <span className="sr-only">orig<span className="text-primary">AI</span>mi</span>
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
            Bank
          </Link>
          <Link
            to="/papers"
            className="text-sm text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            Papers
          </Link>
          <Link
            to="/admin/syllabus"
            className="text-sm text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            Syllabi
          </Link>
        </nav>
      </div>
    </header>
  );
}
