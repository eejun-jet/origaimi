import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Check, RotateCcw, Trash2, Reply } from "lucide-react";
import {
  type AssessmentComment,
  type CommentScope,
  type CommentStatus,
  type ReviewerIdentity,
  ROLE_LABEL,
  ROLE_PILL,
  STATUS_LABEL,
  STATUS_PILL,
  buildThreads,
  relativeTime,
} from "@/lib/comments";

type Props = {
  comments: AssessmentComment[];
  identity: ReviewerIdentity;
  scope: CommentScope;
  /** Scope-specific anchor for new comments. */
  anchor: { questionId?: string | null; sectionLetter?: string | null };
  onAdd: (input: { body: string; parentId: string | null; anchor: Props["anchor"] }) => Promise<void>;
  onSetStatus: (commentId: string, status: CommentStatus) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  /** Compact = inline under question card; full = sidebar dock. */
  compact?: boolean;
  /** Hide the scope badge on each comment (e.g., when already inside a Q card). */
  hideScopeBadge?: boolean;
};

export function CommentThread({
  comments, identity, scope, anchor, onAdd, onSetStatus, onDelete, compact = false, hideScopeBadge = false,
}: Props) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const threads = buildThreads(comments);
  const openCount = comments.filter((c) => c.status === "open" && !c.parent_id).length;

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onAdd({ body: body.trim(), parentId: null, anchor });
      setBody("");
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (parentId: string) => {
    if (!replyBody.trim()) return;
    setBusy(true);
    try {
      await onAdd({ body: replyBody.trim(), parentId, anchor });
      setReplyBody("");
      setReplyingTo(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {threads.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {scope === "paper" && "No paper-wide comments yet."}
          {scope === "section" && "No comments on this section yet."}
          {scope === "question" && "No comments on this question yet."}
        </p>
      )}

      {threads.map((root) => (
        <div key={root.id} className="rounded-lg border border-border bg-background/60 p-3">
          <CommentRow
            c={root}
            identity={identity}
            onSetStatus={onSetStatus}
            onDelete={onDelete}
            onReply={() => { setReplyingTo(replyingTo === root.id ? null : root.id); setReplyBody(""); }}
            hideScopeBadge={hideScopeBadge}
          />

          {root.replies.length > 0 && (
            <div className="ml-4 mt-2 space-y-2 border-l-2 border-border pl-3">
              {root.replies.map((r) => (
                <CommentRow
                  key={r.id}
                  c={r}
                  identity={identity}
                  onSetStatus={onSetStatus}
                  onDelete={onDelete}
                  hideScopeBadge
                  isReply
                />
              ))}
            </div>
          )}

          {replyingTo === root.id && (
            <div className="ml-4 mt-3 space-y-2 border-l-2 border-primary/40 pl-3">
              <Textarea
                rows={2}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={`Reply as ${identity.name} (${ROLE_LABEL[identity.role]})`}
                className="text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReplyingTo(null)}>Cancel</Button>
                <Button size="sm" disabled={busy || !replyBody.trim()} onClick={() => submitReply(root.id)}>
                  Post reply
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Composer */}
      <div className="rounded-lg border border-dashed border-border bg-card/60 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" />
          <span>Commenting as</span>
          <Badge variant="outline" className={`border ${ROLE_PILL[identity.role]}`}>
            {identity.name} · {ROLE_LABEL[identity.role]}
          </Badge>
          {openCount > 0 && (
            <span className="ml-auto text-destructive">
              {openCount} open
            </span>
          )}
        </div>
        <Textarea
          rows={compact ? 2 : 3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            scope === "question"
              ? "What needs changing on this question?"
              : scope === "section"
                ? "Cross-cutting feedback for this section…"
                : "Paper-wide remark for the team…"
          }
          className="mt-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={busy || !body.trim()} onClick={submit}>
            Post comment
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentRow({
  c, identity, onSetStatus, onDelete, onReply, hideScopeBadge, isReply,
}: {
  c: AssessmentComment;
  identity: ReviewerIdentity;
  onSetStatus: (id: string, s: CommentStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReply?: () => void;
  hideScopeBadge?: boolean;
  isReply?: boolean;
}) {
  const isMine = c.author_name === identity.name && c.author_role === identity.role;
  const scopeBadge = !hideScopeBadge && (
    c.scope === "paper" ? "Paper" :
    c.scope === "section" ? `Section ${c.section_letter ?? "?"}` :
    "Question"
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge variant="outline" className={`border ${ROLE_PILL[c.author_role]}`}>
          {c.author_name} · {ROLE_LABEL[c.author_role]}
        </Badge>
        {!isReply && (
          <Badge variant="outline" className={`border ${STATUS_PILL[c.status]}`}>
            {STATUS_LABEL[c.status]}
          </Badge>
        )}
        {scopeBadge && !isReply && (
          <Badge variant="outline" className="text-[10px]">{scopeBadge}</Badge>
        )}
        <span className="text-muted-foreground">· {relativeTime(c.created_at)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{c.body}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {!isReply && onReply && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={onReply}>
            <Reply className="h-3 w-3" /> Reply
          </Button>
        )}
        {!isReply && c.status === "open" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => onSetStatus(c.id, "addressed")}
          >
            <Check className="h-3 w-3" /> Mark addressed
          </Button>
        )}
        {!isReply && c.status !== "resolved" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px] text-success hover:text-success"
            onClick={() => onSetStatus(c.id, "resolved")}
          >
            <Check className="h-3 w-3" /> Resolve
          </Button>
        )}
        {!isReply && c.status === "resolved" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => onSetStatus(c.id, "open")}
          >
            <RotateCcw className="h-3 w-3" /> Re-open
          </Button>
        )}
        {isMine && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
            onClick={() => { if (confirm("Delete this comment?")) onDelete(c.id); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
