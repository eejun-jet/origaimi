import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CommentThread } from "@/components/CommentThread";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, MessageCircle, Settings2 } from "lucide-react";
import {
  type AssessmentComment,
  type CommentRole,
  type CommentScope,
  type CommentStatus,
  type ReviewerIdentity,
  ROLE_LABEL,
  ROLE_OPTIONS,
  ROLE_PILL,
} from "@/lib/comments";

type Props = {
  comments: AssessmentComment[];
  identity: ReviewerIdentity;
  onIdentityChange: (next: ReviewerIdentity) => void;
  /** Letters of the sections in the paper (for filter + section threads). */
  sectionLetters: string[];
  /** Map of question.id → "Q3 · Section B" label for displaying scope context. */
  questionLabels: Record<string, string>;
  onAdd: (input: {
    body: string;
    scope: CommentScope;
    parentId: string | null;
    sectionLetter: string | null;
    questionId: string | null;
  }) => Promise<void>;
  onSetStatus: (commentId: string, status: CommentStatus) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onScrollToQuestion: (questionId: string) => void;
  onScrollToSection: (letter: string) => void;
  onOpenInvite: () => void;
};

export function CommentDock({
  comments,
  identity,
  onIdentityChange,
  sectionLetters,
  questionLabels,
  onAdd,
  onSetStatus,
  onDelete,
  onScrollToQuestion,
  onScrollToSection,
  onOpenInvite,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<"all" | CommentStatus>("open");
  const [roleFilter, setRoleFilter] = useState<"all" | CommentRole>("all");
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [draftName, setDraftName] = useState(identity.name);
  const [draftRole, setDraftRole] = useState<CommentRole>(identity.role);

  const counts = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    return {
      open: roots.filter((c) => c.status === "open").length,
      addressed: roots.filter((c) => c.status === "addressed").length,
      resolved: roots.filter((c) => c.status === "resolved").length,
      total: roots.length,
    };
  }, [comments]);

  const filteredRoots = useMemo(() => {
    return comments.filter((c) => {
      if (c.parent_id) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (roleFilter !== "all" && c.author_role !== roleFilter) return false;
      return true;
    });
  }, [comments, statusFilter, roleFilter]);

  const filteredIds = new Set(filteredRoots.map((r) => r.id));
  const repliesForFiltered = comments.filter((c) => c.parent_id && filteredIds.has(c.parent_id));
  const visible = [...filteredRoots, ...repliesForFiltered];

  const paperComments = visible.filter((c) => c.scope === "paper" || (c.parent_id && comments.find((x) => x.id === c.parent_id)?.scope === "paper"));

  return (
    <div className="space-y-4">
      {/* Identity card */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">You're commenting as</h3>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setEditingIdentity((v) => !v)}>
            <Settings2 className="h-3 w-3" />
            {editingIdentity ? "Done" : "Edit"}
          </Button>
        </div>
        {!editingIdentity ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`border ${ROLE_PILL[identity.role]}`}>
              {identity.name} · {ROLE_LABEL[identity.role]}
            </Badge>
            <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={onOpenInvite}>
              Invite reviewer →
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Your name"
              className="h-8 text-sm"
            />
            <Select value={draftRole} onValueChange={(v) => setDraftRole(v as CommentRole)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                if (draftName.trim()) {
                  onIdentityChange({ name: draftName.trim(), role: draftRole, email: identity.email });
                  setEditingIdentity(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <MessageCircle className="h-4 w-4" /> Comments
          </h3>
          <div className="flex gap-1 text-[10px]">
            <Badge variant="outline" className={`border ${counts.open > 0 ? "border-destructive/30 text-destructive" : ""}`}>
              {counts.open} open
            </Badge>
            <Badge variant="outline">{counts.addressed} addressed</Badge>
            <Badge variant="outline">{counts.resolved} resolved</Badge>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="addressed">Addressed</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Paper-level thread (always visible) */}
      <Collapsible defaultOpen>
        <div className="rounded-xl border border-border bg-card p-4">
          <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
            <span className="flex items-center gap-2 text-sm font-medium">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
              Paper-wide
            </span>
            <Badge variant="outline" className="text-[10px]">
              {comments.filter((c) => c.scope === "paper" && !c.parent_id).length}
            </Badge>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <CommentThread
              comments={paperComments}
              identity={identity}
              scope="paper"
              anchor={{ questionId: null, sectionLetter: null }}
              onAdd={({ body, parentId }) => onAdd({ body, scope: "paper", parentId, sectionLetter: null, questionId: null })}
              onSetStatus={onSetStatus}
              onDelete={onDelete}
              compact
              hideScopeBadge
            />
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Per-section threads */}
      {sectionLetters.map((letter) => {
        const sectionComments = visible.filter((c) => {
          if (c.scope === "section" && c.section_letter === letter) return true;
          if (c.parent_id) {
            const root = comments.find((x) => x.id === c.parent_id);
            return root?.scope === "section" && root.section_letter === letter;
          }
          return false;
        });
        const openInSection = sectionComments.filter((c) => !c.parent_id && c.status === "open").length;
        return (
          <Collapsible key={letter}>
            <div className="rounded-xl border border-border bg-card p-4">
              <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  Section {letter}
                  <button
                    type="button"
                    className="text-[10px] text-primary hover:underline"
                    onClick={(e) => { e.stopPropagation(); onScrollToSection(letter); }}
                  >
                    jump →
                  </button>
                </span>
                <span className="flex gap-1">
                  {openInSection > 0 && (
                    <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">{openInSection}</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {sectionComments.filter((c) => !c.parent_id).length}
                  </Badge>
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <CommentThread
                  comments={sectionComments}
                  identity={identity}
                  scope="section"
                  anchor={{ questionId: null, sectionLetter: letter }}
                  onAdd={({ body, parentId }) => onAdd({ body, scope: "section", parentId, sectionLetter: letter, questionId: null })}
                  onSetStatus={onSetStatus}
                  onDelete={onDelete}
                  compact
                  hideScopeBadge
                />
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}

      {/* Question-level: just a list, click to scroll to question */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium">Question comments</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Click to jump to the question's inline thread.
        </p>
        <div className="mt-3 space-y-2">
          {(() => {
            const byQ = new Map<string, AssessmentComment[]>();
            for (const c of visible.filter((c) => c.scope === "question" || (c.parent_id && comments.find((x) => x.id === c.parent_id)?.scope === "question"))) {
              const qid = c.question_id ?? (c.parent_id && comments.find((x) => x.id === c.parent_id)?.question_id) ?? null;
              if (!qid) continue;
              const arr = byQ.get(qid) ?? [];
              arr.push(c);
              byQ.set(qid, arr);
            }
            if (byQ.size === 0) {
              return <p className="text-xs text-muted-foreground">No question-level comments match the current filter.</p>;
            }
            return Array.from(byQ.entries()).map(([qid, qComments]) => {
              const open = qComments.filter((c) => !c.parent_id && c.status === "open").length;
              const total = qComments.filter((c) => !c.parent_id).length;
              const last = qComments[qComments.length - 1];
              return (
                <button
                  key={qid}
                  type="button"
                  onClick={() => onScrollToQuestion(qid)}
                  className="flex w-full items-start gap-2 rounded-lg border border-border bg-background/50 p-2 text-left hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{questionLabels[qid] ?? "Question"}</span>
                      {open > 0 && (
                        <Badge variant="outline" className="h-4 border-destructive/30 px-1 text-[9px] text-destructive">
                          {open} open
                        </Badge>
                      )}
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">{total}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                      <span className="font-medium">{last.author_name}:</span> {last.body}
                    </p>
                  </div>
                </button>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
