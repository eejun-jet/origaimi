import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { buildShareUrl, ROLE_OPTIONS, type CommentRole } from "@/lib/comments";

type Props = {
  assessmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function InviteReviewerDialog({ assessmentId, open, onOpenChange }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CommentRole>("vetter");
  const [copied, setCopied] = useState(false);

  const url = name.trim() ? buildShareUrl({ assessmentId, role, name: name.trim(), email: email.trim() || null }) : "";

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Invite link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a reviewer</DialogTitle>
          <DialogDescription>
            Build a share link that opens this paper as a named reviewer.
            They'll be able to comment on the whole paper, on a section, or on individual questions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="rev-name">Reviewer name</Label>
            <Input
              id="rev-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mrs Tan"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="rev-email">Email (optional)</Label>
            <Input
              id="rev-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mrs.tan@school.edu.sg"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as CommentRole)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.filter((r) => r.value !== "author").map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    <div>
                      <div className="font-medium">{r.label}</div>
                      <div className="text-xs text-muted-foreground">{r.help}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {url && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <Label className="text-xs text-muted-foreground">Share link</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input readOnly value={url} className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={copy} className="gap-1 shrink-0">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Send this link to the reviewer. When they open it, comments they post will be attributed to them automatically.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
