import { useEffect, useState } from "react";

export type CommentRole = "author" | "peer_setter" | "vetter" | "clearance" | "other";
export type CommentStatus = "open" | "addressed" | "resolved";
export type CommentScope = "paper" | "section" | "question";

export type AssessmentComment = {
  id: string;
  assessment_id: string;
  scope: CommentScope;
  section_letter: string | null;
  question_id: string | null;
  parent_id: string | null;
  author_name: string;
  author_email: string | null;
  author_role: CommentRole;
  body: string;
  status: CommentStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export const ROLE_LABEL: Record<CommentRole, string> = {
  author: "Author",
  peer_setter: "Peer-setter",
  vetter: "Vetter",
  clearance: "Clearance",
  other: "Reviewer",
};

/**
 * Tailwind classes for the role pill. Uses semantic tokens so the chips
 * stay legible in both themes.
 */
export const ROLE_PILL: Record<CommentRole, string> = {
  author: "bg-muted text-muted-foreground border-border",
  peer_setter: "bg-primary-soft text-primary border-primary/30",
  vetter: "bg-warm/30 text-warm-foreground border-warm",
  clearance: "bg-success/15 text-success border-success/30",
  other: "bg-muted text-muted-foreground border-border",
};

export const STATUS_LABEL: Record<CommentStatus, string> = {
  open: "Open",
  addressed: "Addressed",
  resolved: "Resolved",
};

export const STATUS_PILL: Record<CommentStatus, string> = {
  open: "bg-destructive/10 text-destructive border-destructive/30",
  addressed: "bg-warm/30 text-warm-foreground border-warm",
  resolved: "bg-success/15 text-success border-success/30",
};

export const ROLE_OPTIONS: { value: CommentRole; label: string; help: string }[] = [
  { value: "author", label: "Author", help: "Original paper-setter" },
  { value: "peer_setter", label: "Peer-setter", help: "Fellow setter giving design feedback" },
  { value: "vetter", label: "Vetter", help: "Subject-matter checker" },
  { value: "clearance", label: "Clearance", help: "Final HOD / clearance personnel" },
  { value: "other", label: "Other", help: "Any other reviewer" },
];

// ─────────────────────────── Reviewer identity ───────────────────────────

export type ReviewerIdentity = { name: string; role: CommentRole; email: string | null };

const STORAGE_KEY = "origaimi.reviewer";

function loadStoredIdentity(): ReviewerIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.name || !parsed?.role) return null;
    return { name: String(parsed.name), role: parsed.role as CommentRole, email: parsed.email ?? null };
  } catch {
    return null;
  }
}

function saveStoredIdentity(id: ReviewerIdentity) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
}

/**
 * Reviewer identity hook. Priority: URL params (?as=&name=&email=) →
 * localStorage → "You / Author". Updating it persists to localStorage so
 * the identity sticks across refreshes for the same browser.
 */
export function useReviewerIdentity(): [ReviewerIdentity, (next: ReviewerIdentity) => void] {
  const [identity, setIdentity] = useState<ReviewerIdentity>(() => {
    if (typeof window === "undefined") return { name: "You", role: "author", email: null };
    const params = new URLSearchParams(window.location.search);
    const urlAs = params.get("as");
    const urlName = params.get("name");
    const urlEmail = params.get("email");
    if (urlAs && urlName) {
      const role = (["author", "peer_setter", "vetter", "clearance", "other"].includes(urlAs)
        ? urlAs
        : "other") as CommentRole;
      const seeded = { name: urlName, role, email: urlEmail };
      saveStoredIdentity(seeded);
      return seeded;
    }
    return loadStoredIdentity() ?? { name: "You", role: "author", email: null };
  });

  const update = (next: ReviewerIdentity) => {
    saveStoredIdentity(next);
    setIdentity(next);
  };

  return [identity, update];
}

// ─────────────────────────── Share-link helper ───────────────────────────

export function buildShareUrl(opts: {
  assessmentId: string;
  role: CommentRole;
  name: string;
  email?: string | null;
}): string {
  if (typeof window === "undefined") return "";
  const url = new URL(`${window.location.origin}/assessment/${opts.assessmentId}`);
  url.searchParams.set("as", opts.role);
  url.searchParams.set("name", opts.name);
  if (opts.email) url.searchParams.set("email", opts.email);
  return url.toString();
}

// ─────────────────────────── Misc helpers ───────────────────────────

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Build a tree of root comments → replies, preserving server order. */
export function buildThreads(comments: AssessmentComment[]): Array<AssessmentComment & { replies: AssessmentComment[] }> {
  const byParent = new Map<string, AssessmentComment[]>();
  for (const c of comments) {
    if (c.parent_id) {
      const arr = byParent.get(c.parent_id) ?? [];
      arr.push(c);
      byParent.set(c.parent_id, arr);
    }
  }
  return comments
    .filter((c) => !c.parent_id)
    .map((root) => ({ ...root, replies: byParent.get(root.id) ?? [] }));
}

/** Hook to subscribe to identity localStorage changes from elsewhere. */
export function useIdentityVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setV((x) => x + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return v;
}
