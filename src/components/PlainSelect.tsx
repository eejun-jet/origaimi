import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Custom dropdown built without a native <select> so browser extensions like
// "BetterBrowse" (bb-customSelect) cannot hijack it. Menu is portaled to body
// so no parent stacking context / overflow can hide it.
export function PlainSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      setRect({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={cn("relative", className)} data-lov-plain-select="" data-no-bb="">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        data-no-bb=""
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn(!current && "text-muted-foreground")}>
          {current?.label ?? placeholder ?? "Select…"}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
      {open && rect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              data-no-bb=""
              style={{ position: "absolute", top: rect.top, left: rect.left, width: rect.width, zIndex: 9999 }}
              className="max-h-72 overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
            >
              {options.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
              ) : options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  data-no-bb=""
                  onClick={() => { onValueChange(o.value); setOpen(false); }}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span>{o.label}</span>
                  {o.value === value ? <Check className="h-4 w-4" /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
