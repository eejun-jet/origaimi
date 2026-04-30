// Difficulty fingerprint — computed at parse time on a past paper, and at
// review time on a generated paper, so the Coach can compare them. Pure
// functions only; no I/O. Deno-compatible (no Node-specific APIs).

export type FingerprintQuestion = {
  marks?: number | null;
  command_word?: string | null;
  stem?: string | null;
  bloom_level?: string | null;
  ao_codes?: string[] | null;
  sub_parts?: Array<{ marks?: number | null; command_word?: string | null }> | null;
};

export type DifficultyFingerprint = {
  version: 1;
  is_specimen: boolean;
  total_marks: number;
  question_count: number;
  marks_per_question: {
    min: number;
    median: number;
    max: number;
    avg: number;
    histogram: Record<string, number>; // "1-3" | "4-6" | "7-12" | "13+"
  };
  command_word_freq: Record<string, number>; // lowercased -> count
  bloom_mix_pct: Record<BloomBucket, number>;
  ao_mark_share_pct: Record<string, number>; // "AO1" -> %
  sub_part_depth_avg: number; // avg sub-parts per question
};

export type BloomBucket = "remember" | "understand" | "apply" | "analyse" | "evaluate" | "create";

const BLOOM_BUCKETS: BloomBucket[] = ["remember", "understand", "apply", "analyse", "evaluate", "create"];

// Map common command words to a Bloom bucket. Conservative: when in doubt,
// default to "apply" — neither under- nor over-inflating cognitive demand.
const COMMAND_WORD_TO_BLOOM: Record<string, BloomBucket> = {
  // remember
  "state": "remember", "list": "remember", "name": "remember", "define": "remember",
  "identify": "remember", "recall": "remember", "label": "remember",
  // understand
  "describe": "understand", "summarise": "understand", "summarize": "understand",
  "outline": "understand", "explain": "understand", "interpret": "understand",
  "illustrate": "understand", "classify": "understand",
  // apply
  "calculate": "apply", "compute": "apply", "solve": "apply", "use": "apply",
  "demonstrate": "apply", "show": "apply", "predict": "apply", "deduce": "apply",
  "apply": "apply", "construct": "apply", "draw": "apply", "complete": "apply",
  "find": "apply", "determine": "apply", "work out": "apply",
  // analyse
  "analyse": "analyse", "analyze": "analyse", "compare": "analyse",
  "contrast": "analyse", "differentiate": "analyse", "examine": "analyse",
  "infer": "analyse", "distinguish": "analyse",
  // evaluate
  "evaluate": "evaluate", "justify": "evaluate", "assess": "evaluate",
  "criticise": "evaluate", "criticize": "evaluate", "judge": "evaluate",
  "discuss": "evaluate", "argue": "evaluate", "decide": "evaluate",
  "to what extent": "evaluate", "how far": "evaluate",
  // create
  "design": "create", "devise": "create", "propose": "create", "plan": "create",
  "develop": "create", "compose": "create",
};

function normaliseCommandWord(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (!lower) return null;
  // Multi-word phrases first.
  if (lower.startsWith("to what extent")) return "to what extent";
  if (lower.startsWith("how far")) return "how far";
  if (lower.startsWith("work out")) return "work out";
  // Single leading verb (strip punctuation).
  const firstWord = lower.split(/[\s,.;:?!()]/)[0] ?? "";
  return firstWord || null;
}

function inferCommandWordFromStem(stem: string | null | undefined): string | null {
  if (!stem) return null;
  const trimmed = stem.trim().toLowerCase();
  if (!trimmed) return null;
  // Look at the first ~80 chars; pick the first known command verb that appears.
  const head = trimmed.slice(0, 120);
  // Multi-word phrases.
  if (/\bto what extent\b/.test(head)) return "to what extent";
  if (/\bhow far\b/.test(head)) return "how far";
  // Find the first known single-verb command word.
  const tokens = head.split(/[^a-z]+/).filter(Boolean);
  for (const t of tokens) {
    if (t in COMMAND_WORD_TO_BLOOM) return t;
  }
  return null;
}

function bloomBucketFor(commandWord: string | null, declaredBloom: string | null | undefined): BloomBucket | null {
  // Prefer the declared Bloom level if it maps cleanly.
  if (declaredBloom) {
    const b = declaredBloom.toLowerCase().trim();
    for (const bucket of BLOOM_BUCKETS) {
      if (b === bucket || b.startsWith(bucket)) return bucket;
    }
    if (b.includes("understand") || b.includes("comprehen")) return "understand";
    if (b.includes("remember") || b.includes("knowledge") || b.includes("recall")) return "remember";
    if (b.includes("apply") || b.includes("application")) return "apply";
    if (b.includes("analy")) return "analyse";
    if (b.includes("evaluat")) return "evaluate";
    if (b.includes("creat") || b.includes("synth")) return "create";
  }
  if (!commandWord) return null;
  return COMMAND_WORD_TO_BLOOM[commandWord] ?? null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
    : sorted[mid];
}

function marksHistogram(marks: number[]): Record<string, number> {
  const buckets: Record<string, number> = { "1-3": 0, "4-6": 0, "7-12": 0, "13+": 0 };
  for (const m of marks) {
    if (m <= 3) buckets["1-3"]++;
    else if (m <= 6) buckets["4-6"]++;
    else if (m <= 12) buckets["7-12"]++;
    else buckets["13+"]++;
  }
  return buckets;
}

function pctRound(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10; // 1 dp
}

export function isSpecimenPaper(meta: { title?: string | null; notes?: string | null; paper_number?: string | null }): boolean {
  const hay = `${meta.title ?? ""} ${meta.notes ?? ""} ${meta.paper_number ?? ""}`.toLowerCase();
  return /(specimen|sample|exemplar)/.test(hay);
}

/** Build a fingerprint from a list of questions. Safe with empty input. */
export function computeFingerprint(
  questions: FingerprintQuestion[],
  meta: { title?: string | null; notes?: string | null; paper_number?: string | null },
): DifficultyFingerprint {
  const marks: number[] = [];
  const commandFreq: Record<string, number> = {};
  const bloomCounts: Record<BloomBucket, number> = {
    remember: 0, understand: 0, apply: 0, analyse: 0, evaluate: 0, create: 0,
  };
  const aoMarks: Record<string, number> = {};
  let totalMarks = 0;
  let subPartTotal = 0;
  let bloomClassified = 0;

  for (const q of questions) {
    const m = Math.max(0, Math.floor(q.marks ?? 0));
    marks.push(m);
    totalMarks += m;
    subPartTotal += Array.isArray(q.sub_parts) ? q.sub_parts.length : 0;

    const cw = normaliseCommandWord(q.command_word) ?? inferCommandWordFromStem(q.stem);
    if (cw) commandFreq[cw] = (commandFreq[cw] ?? 0) + 1;

    const bucket = bloomBucketFor(cw, q.bloom_level ?? null);
    if (bucket) {
      bloomCounts[bucket]++;
      bloomClassified++;
    }

    // AO mark share — split a question's marks evenly across its declared AOs.
    const aos = Array.isArray(q.ao_codes) ? q.ao_codes.filter((a): a is string => typeof a === "string" && a.trim().length > 0) : [];
    if (aos.length > 0 && m > 0) {
      const share = m / aos.length;
      for (const ao of aos) {
        const key = ao.trim().toUpperCase();
        aoMarks[key] = (aoMarks[key] ?? 0) + share;
      }
    }
  }

  const positiveMarks = marks.filter((m) => m > 0);
  const minM = positiveMarks.length > 0 ? Math.min(...positiveMarks) : 0;
  const maxM = positiveMarks.length > 0 ? Math.max(...positiveMarks) : 0;
  const medM = median(positiveMarks);
  const avgM = positiveMarks.length > 0
    ? Math.round((positiveMarks.reduce((a, b) => a + b, 0) / positiveMarks.length) * 10) / 10
    : 0;

  const bloomMixPct: Record<BloomBucket, number> = {
    remember: 0, understand: 0, apply: 0, analyse: 0, evaluate: 0, create: 0,
  };
  if (bloomClassified > 0) {
    for (const b of BLOOM_BUCKETS) {
      bloomMixPct[b] = pctRound(bloomCounts[b], bloomClassified);
    }
  }

  const aoMarkSharePct: Record<string, number> = {};
  const aoTotal = Object.values(aoMarks).reduce((a, b) => a + b, 0);
  if (aoTotal > 0) {
    for (const [ao, val] of Object.entries(aoMarks)) {
      aoMarkSharePct[ao] = pctRound(val, aoTotal);
    }
  }

  return {
    version: 1,
    is_specimen: isSpecimenPaper(meta),
    total_marks: totalMarks,
    question_count: questions.length,
    marks_per_question: {
      min: minM,
      median: medM,
      max: maxM,
      avg: avgM,
      histogram: marksHistogram(positiveMarks),
    },
    command_word_freq: commandFreq,
    bloom_mix_pct: bloomMixPct,
    ao_mark_share_pct: aoMarkSharePct,
    sub_part_depth_avg: questions.length > 0
      ? Math.round((subPartTotal / questions.length) * 10) / 10
      : 0,
  };
}

/** Collapse the 6-bucket Bloom mix to easy/medium/hard percentages. */
export function bloomMixToDifficultyMix(
  bloomMixPct: Record<BloomBucket, number>,
): { easy: number; medium: number; hard: number } {
  const easy = Math.round(bloomMixPct.remember + bloomMixPct.understand);
  const medium = Math.round(bloomMixPct.apply + bloomMixPct.analyse);
  const hard = Math.round(bloomMixPct.evaluate + bloomMixPct.create);
  // Re-normalise to 100 in case rounding drifts.
  const sum = easy + medium + hard;
  if (sum === 0) return { easy: 30, medium: 50, hard: 20 };
  return {
    easy: Math.round((easy / sum) * 100),
    medium: Math.round((medium / sum) * 100),
    hard: 100 - Math.round((easy / sum) * 100) - Math.round((medium / sum) * 100),
  };
}

export type CalibrationFinding = {
  has_specimen: boolean;
  specimen_title?: string;
  bloom_drift: { level: BloomBucket; specimen_pct: number; observed_pct: number; delta: number; severity: "info" | "warn" | "fail" }[];
  ao_drift: { ao: string; specimen_pct: number; observed_pct: number; delta: number; severity: "info" | "warn" | "fail" }[];
  marks_shape_drift: { metric: "median" | "max" | "avg" | "avg_subparts"; specimen: number; observed: number; severity: "info" | "warn" | "fail" }[];
  command_word_gaps: string[];
  severity: "info" | "warn" | "fail";
  note: string;
};

function severityForPct(deltaAbs: number): "info" | "warn" | "fail" {
  if (deltaAbs > 15) return "fail";
  if (deltaAbs > 8) return "warn";
  return "info";
}

function severityForRatio(specimen: number, observed: number): "info" | "warn" | "fail" {
  if (specimen <= 0 && observed <= 0) return "info";
  const base = Math.max(specimen, 1);
  const ratio = Math.abs(observed - specimen) / base;
  if (ratio > 0.5) return "fail";
  if (ratio > 0.25) return "warn";
  return "info";
}

/** Diff observed (generated) fingerprint against specimen. */
export function diffFingerprints(
  specimen: DifficultyFingerprint | null,
  observed: DifficultyFingerprint,
  specimenTitle?: string,
): CalibrationFinding {
  if (!specimen) {
    return {
      has_specimen: false,
      bloom_drift: [],
      ao_drift: [],
      marks_shape_drift: [],
      command_word_gaps: [],
      severity: "info",
      note: "No specimen paper parsed for this subject + level. Upload one in Papers to enable calibration.",
    };
  }

  const bloomDrift = BLOOM_BUCKETS.map((b) => {
    const sp = specimen.bloom_mix_pct[b] ?? 0;
    const ob = observed.bloom_mix_pct[b] ?? 0;
    const delta = Math.round((ob - sp) * 10) / 10;
    return { level: b, specimen_pct: sp, observed_pct: ob, delta, severity: severityForPct(Math.abs(delta)) };
  }).filter((d) => d.specimen_pct > 0 || d.observed_pct > 0);

  const aoKeys = Array.from(new Set([
    ...Object.keys(specimen.ao_mark_share_pct ?? {}),
    ...Object.keys(observed.ao_mark_share_pct ?? {}),
  ]));
  const aoDrift = aoKeys.map((ao) => {
    const sp = specimen.ao_mark_share_pct[ao] ?? 0;
    const ob = observed.ao_mark_share_pct[ao] ?? 0;
    const delta = Math.round((ob - sp) * 10) / 10;
    return { ao, specimen_pct: sp, observed_pct: ob, delta, severity: severityForPct(Math.abs(delta)) };
  });

  const marksShapeDrift: CalibrationFinding["marks_shape_drift"] = [
    { metric: "median", specimen: specimen.marks_per_question.median, observed: observed.marks_per_question.median, severity: severityForRatio(specimen.marks_per_question.median, observed.marks_per_question.median) },
    { metric: "max", specimen: specimen.marks_per_question.max, observed: observed.marks_per_question.max, severity: severityForRatio(specimen.marks_per_question.max, observed.marks_per_question.max) },
    { metric: "avg", specimen: specimen.marks_per_question.avg, observed: observed.marks_per_question.avg, severity: severityForRatio(specimen.marks_per_question.avg, observed.marks_per_question.avg) },
    { metric: "avg_subparts", specimen: specimen.sub_part_depth_avg, observed: observed.sub_part_depth_avg, severity: severityForRatio(specimen.sub_part_depth_avg, observed.sub_part_depth_avg) },
  ];

  // Command-word gaps: any command word that appears ≥ 2× in the specimen and 0× in the observed.
  const commandWordGaps: string[] = [];
  for (const [cw, count] of Object.entries(specimen.command_word_freq ?? {})) {
    if (count >= 2 && (observed.command_word_freq?.[cw] ?? 0) === 0) {
      commandWordGaps.push(cw);
    }
  }

  const allSeverities = [
    ...bloomDrift.map((d) => d.severity),
    ...aoDrift.map((d) => d.severity),
    ...marksShapeDrift.map((d) => d.severity),
  ];
  const overall: "info" | "warn" | "fail" = allSeverities.includes("fail")
    ? "fail"
    : allSeverities.includes("warn")
      ? "warn"
      : "info";

  let note = "Calibrated against specimen — distribution looks aligned.";
  if (overall === "fail") {
    note = "Significant drift from the specimen on at least one dimension (>15pp Bloom/AO, or marks shape off by >50%).";
  } else if (overall === "warn") {
    note = "Moderate drift from the specimen. Review the highlighted rows.";
  }

  return {
    has_specimen: true,
    specimen_title: specimenTitle,
    bloom_drift: bloomDrift,
    ao_drift: aoDrift,
    marks_shape_drift: marksShapeDrift,
    command_word_gaps: commandWordGaps,
    severity: overall,
    note,
  };
}
