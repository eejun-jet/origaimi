// AO rollup — collapses sub-objective codes (A1, A2, …, B1, …, C1, …) into
// their letter-prefix bucket (A, B, C, …) so the AO review reflects the
// syllabus-level weighting (e.g. Chemistry: A=50%, B=50%) instead of showing
// each granular code as a separate row.

export type AODefLike = {
  code: string;
  title?: string | null;
  weighting_percent?: number | null;
  weightingPercent?: number | null;
};

const CODE_RE = /^([A-Z])\d+$/;

/** Returns the letter-prefix bucket for an AO code, or the original code
 *  unchanged if it doesn't match the `<Letter><digits>` shape (so labels like
 *  "Untagged" are preserved). */
export function bucketOf(code: string): string {
  const m = code.match(CODE_RE);
  return m ? m[1] : code;
}

/** Aggregate a `Map<code, number>` (or plain object) into `Map<bucket, number>`. */
export function rollupCounts(input: Map<string, number> | Record<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const entries = input instanceof Map ? Array.from(input.entries()) : Object.entries(input);
  for (const [code, n] of entries) {
    const b = bucketOf(code);
    out.set(b, (out.get(b) ?? 0) + (n || 0));
  }
  return out;
}

/** Aggregate per-bucket weighting targets from the stored AO definitions.
 *
 *  Behaviour:
 *  - If the syllabus already declares weights at the bucket level (e.g. a row
 *    with `code: "A"` and `weighting_percent: 50`), use those directly.
 *  - Otherwise, sum sub-code weights into their bucket. If the resulting
 *    totals don't sum to 100 (common: only the top 3 sub-codes carry weight,
 *    e.g. A1=40, A2=40, A3=20 within an A-only bucket), re-normalise so
 *    declared buckets sum to 100. This converts a stored A1/A2/A3=40/40/20
 *    layout into A=100% (single bucket) without affecting multi-bucket
 *    syllabi where each bucket already has its share. */
export function bucketTargets(defs: AODefLike[] | null | undefined): Map<string, number> {
  if (!defs || defs.length === 0) return new Map();

  // Prefer canonical bucket-level rows when present.
  const canonical = new Map<string, number>();
  for (const d of defs) {
    const code = d.code?.trim();
    if (!code || !/^[A-Z]$/.test(code)) continue;
    const w = d.weighting_percent ?? d.weightingPercent ?? null;
    if (typeof w === "number") canonical.set(code, (canonical.get(code) ?? 0) + w);
  }
  if (canonical.size > 0) return canonical;

  // Fall back to summing sub-code weights into their bucket.
  const totals = new Map<string, number>();
  for (const d of defs) {
    const code = d.code?.trim();
    if (!code) continue;
    const w = d.weighting_percent ?? d.weightingPercent ?? null;
    if (typeof w !== "number") continue;
    const b = bucketOf(code);
    totals.set(b, (totals.get(b) ?? 0) + w);
  }
  if (totals.size === 0) return totals;

  const sum = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  if (sum === 0) return totals;
  // Re-normalise so declared buckets sum to 100.
  const normalised = new Map<string, number>();
  for (const [b, v] of totals) normalised.set(b, Math.round((v / sum) * 100));
  return normalised;
}

/** All bucket letters present across the AO definitions. */
export function bucketsFromDefs(defs: AODefLike[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const d of defs ?? []) {
    const code = d.code?.trim();
    if (code) set.add(bucketOf(code));
  }
  return Array.from(set).sort();
}
