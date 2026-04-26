import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type AssessmentComment,
  type CommentScope,
  type CommentTargetKind,
  type ReviewerIdentity,
  ROLE_LABEL,
  ROLE_PILL,
  STATUS_LABEL,
  STATUS_PILL,
  relativeTime,
} from "@/lib/comments";
import { CheckCircle2, MessageCircle, Trash2, Loader2 } from "lucide-react";

export type DetailDrawerProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Drawer header */
  title: string;
  subtitle?: string;
  badges?: { label: string; tone?: "default" | "success" | "warn" | "destructive" }[];
  /** Custom body content (e.g. evidence list) */
  children?: React.ReactNode;
  /** Remarks scope + target key for persistence */
  scope: CommentScope;
  targetKind: CommentTargetKind;
  targetKey: string;
  /** Existing comments (parent already filtered to this target) */
  comments: AssessmentComment[];
  identity: ReviewerIdentity;
  onAddComment: (input: {
    body: string;
    scope: CommentScope;
    parentId: string | null;
    sectionLetter: string | null;
    questionId: string | null;
    targetKind: CommentTargetKind;
    targetKey: string;
  }) => Promise<void> | void;
  onSetCommentStatus: (commentId: string, status: "open" | "addressed" | "resolved") => Promise<void> | void;
  onDeleteComment: (commentId: string) => Promise<void> | void;
  /** Optional section letter to attach to new remarks */
  sectionLetter?: string | null;
};

const TONE_CLASS: Record<NonNullable<DetailDrawerProps["badges"]>[number]["tone"] & string, string> = {
  default: "bg-muted text-foreground border-border",
  success: "bg-success/15 text-success border-success/30",
  warn: "bg-warm/30 text-warm-foreground border-warm",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
};

export function DetailDrawer(props: DetailDrawerProps) {
  const {
    open,
    onOpenChange,
    title,
    subtitle,
    badges,
    children,
    scope,
    targetKind,
    targetKey,
    comments,
    identity,
    onAddComment,
    onSetCommentStatus,
    onDeleteComment,
    sectionLetter = null,
  } = props;

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [comments],
  );

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      await onAddComment({
        body,
        scope,
        parentId: null,
        sectionLetter,
        questionId: null,
        targetKind,
        targetKey,
      });
      setDraft("");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle className="text-base leading-tight">{title}</SheetTitle>
          {subtitle && <SheetDescription className="text-xs">{subtitle}</SheetDescription>}
          {badges && badges.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {badges.map((b, i) => (
                <span
                  key={`${b.label}-${i}`}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS[b.tone ?? "default"]}`}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </SheetHeader>

        {children && (
          <div className="mt-4 space-y-3 text-sm">
            {children}
          </div>
        )}

        <Separator className="my-5" />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-sm font-medium">Remarks</h4>
            <Badge variant="outline" className="h-4 px-1 text-[10px]">{sorted.length}</Badge>
          </div>

          {sorted.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No remarks yet. Use the box below to leave a note for yourself or your reviewers.
            </p>
          )}

          <ul className="space-y-2">
            {sorted.map((c) => (
              <li key={c.id} className="rounded-md border border-border bg-card p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{c.author_name}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${ROLE_PILL[c.author_role]}`}>
                    {ROLE_LABEL[c.author_role]}
                  </span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${STATUS_PILL[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{relativeTime(c.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{c.body}</p>
                <div className="mt-1.5 flex items-center justify-end gap-1">
                  {c.status !== "resolved" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-[10px]"
                      onClick={() => onSetCommentStatus(c.id, "resolved")}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Resolve
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => onSetCommentStatus(c.id, "open")}
                    >
                      Reopen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                    onClick={() => onDeleteComment(c.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-2 pt-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Add a remark as ${identity.name} · ${ROLE_LABEL[identity.role]}…`}
              className="min-h-[72px] text-xs"
            />
            <div className="flex items-center justify-end">
              <Button size="sm" onClick={submit} disabled={posting || !draft.trim()} className="gap-1.5">
                {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                Post remark
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
