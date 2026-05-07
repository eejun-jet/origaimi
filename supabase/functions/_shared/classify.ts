// Shared question→syllabus classifier used by `parse-paper` (during initial
// upload) and `reclassify-paper` (manual re-run for already-parsed papers).
//
// Why this exists separately:
// - The previous in-line classifier sent ALL questions + the FULL catalogue in
//   one prompt and raced it against a 30s timeout. For a 20-question Sciences
//   paper that prompt regularly took >30s, the timeout fired, and every
//   question was saved with empty AO/KO/LO arrays — making the macro reviewer
//   useless.
// - Here we batch questions (default 6 per request), prune the catalogue per
//   batch by keyword overlap, run small batches in parallel with a per-call
//   timeout, retry with a faster model on failure, and finally fall back to a
//   deterministic keyword match so we never return totally empty tags.

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

export type ClassifyQuestionInput = {
  number: string;
  stem: string;
  command_word?: string | null;
  marks?: number | null;
  sub_parts?: { label: string; text: string }[];
};

export type CatalogueEntry = {
  topic_code: string;
  title: string;
  learning_outcome_code: string;
  learning_outcomes: string[];
  ao_codes: string[];
  knowledge_outcomes: string[];
};

export type ClassifyResult = {
  topic_code: string;
  learning_outcomes: string[];
  knowledge_outcomes: string[];
  ao_codes: string[];
  bloom_level: string | null;
};

const STOP = new Set([
  "the","a","an","of","to","in","on","at","is","are","was","were","be","been",
  "and","or","but","for","with","by","from","as","that","this","these","those",
  "it","its","their","his","her","which","what","when","why","how","who","whom",
  "into","than","then","there","here","also","such","may","might","can","will",
  "shall","should","would","could","do","does","did","not","no","yes","one","two",
]);

function tokens(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

function questionText(q: ClassifyQuestionInput): string {
  const sub = (q.sub_parts ?? []).map((s) => s.text ?? "").join(" ");
  return `${q.stem ?? ""} ${sub}`;
}

// Pick the top N catalogue entries most relevant to the given batch of
// questions, by simple token-overlap scoring. Falls back to the first N if
// nothing scores.
function pruneCatalogue(
  catalogue: CatalogueEntry[],
  batch: ClassifyQuestionInput[],
  limit = 60,
): CatalogueEntry[] {
  if (catalogue.length <= limit) return catalogue;
  const batchTokens = new Set(batch.flatMap((q) => tokens(questionText(q))));
  if (batchTokens.size === 0) return catalogue.slice(0, limit);
  const scored = catalogue.map((t) => {
    const text = [
      t.title,
      t.learning_outcomes.join(" "),
      t.knowledge_outcomes.join(" "),
    ].join(" ");
    let score = 0;
    for (const tok of tokens(text)) if (batchTokens.has(tok)) score++;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.t);
  if (top.length >= 20) return top;
  // Backfill with first-N to ensure the model sees a reasonable canvas.
  const seen = new Set(top.map((x) => x.topic_code + "|" + x.learning_outcome_code));
  for (const t of catalogue) {
    if (top.length >= limit) break;
    const key = t.topic_code + "|" + t.learning_outcome_code;
    if (!seen.has(key)) { top.push(t); seen.add(key); }
  }
  return top;
}

function catalogueLines(catalogue: CatalogueEntry[]): string {
  return catalogue.map((t, i) =>
    `[${i}] code=${t.topic_code} title="${t.title}" LO_code=${t.learning_outcome_code} LOs=${(t.learning_outcomes ?? []).slice(0, 6).join("|")} AOs=${(t.ao_codes ?? []).join(",")} KOs=${(t.knowledge_outcomes ?? []).slice(0, 4).join("|")}`,
  ).join("\n");
}

const TOOL_CLASSIFY = {
  type: "function",
  function: {
    name: "save_classifications",
    description: "Map each question to syllabus topic_code, learning_outcomes, knowledge_outcomes, ao_codes, bloom_level.",
    parameters: {
      type: "object",
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_number: { type: "string" },
              topic_code: { type: "string" },
              learning_outcomes: { type: "array", items: { type: "string" } },
              knowledge_outcomes: { type: "array", items: { type: "string" } },
              ao_codes: { type: "array", items: { type: "string" } },
              bloom_level: {
                type: "string",
                enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"],
              },
            },
            required: ["question_number"],
            additionalProperties: false,
          },
        },
      },
      required: ["mappings"],
      additionalProperties: false,
    },
  },
};

async function classifyBatch(
  batch: ClassifyQuestionInput[],
  catalogue: CatalogueEntry[],
  subject: string,
  level: string,
  model: string,
  timeoutMs: number,
): Promise<Record<string, ClassifyResult>> {
  const pruned = pruneCatalogue(catalogue, batch, 60);
  const items = batch.map((q) => ({
    number: q.number,
    stem: (q.stem ?? "").slice(0, 800),
    sub_parts: (q.sub_parts ?? []).slice(0, 8).map((s) => ({ label: s.label, text: (s.text ?? "").slice(0, 400) })),
    command_word: q.command_word ?? null,
    marks: q.marks ?? null,
  }));

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `You map past-paper exam questions to a syllabus catalogue. For each question pick exactly one topic_code from the catalogue, then list the specific learning_outcomes, knowledge_outcomes (high-level outcome categories), and ao_codes (assessment objectives) it tests. Add a Bloom level. Use exact codes/strings from the catalogue. Subject: ${subject}. Level: ${level}.`,
          },
          {
            role: "user",
            content: `CATALOGUE:\n${catalogueLines(pruned)}\n\nQUESTIONS:\n${JSON.stringify(items)}`,
          },
        ],
        tools: [TOOL_CLASSIFY],
        tool_choice: { type: "function", function: { name: "save_classifications" } },
      }),
    });
  } finally {
    clearTimeout(t);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`AI ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  const tc = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) return {};
  let parsed: { mappings?: Array<Partial<ClassifyResult> & { question_number?: string }> } = {};
  try { parsed = JSON.parse(tc.function.arguments); } catch { return {}; }
  const out: Record<string, ClassifyResult> = {};
  for (const m of parsed.mappings ?? []) {
    if (!m.question_number) continue;
    out[String(m.question_number)] = {
      topic_code: m.topic_code ?? "",
      learning_outcomes: Array.isArray(m.learning_outcomes) ? m.learning_outcomes : [],
      knowledge_outcomes: Array.isArray(m.knowledge_outcomes) ? m.knowledge_outcomes : [],
      ao_codes: Array.isArray(m.ao_codes) ? m.ao_codes : [],
      bloom_level: typeof m.bloom_level === "string" ? m.bloom_level : null,
    };
  }
  return out;
}

// Deterministic keyword-match fallback: for any question still missing tags,
// score each catalogue entry by token overlap against the question text and
// pick the top one. Better than empty arrays — at least the macro reviewer
// has signal to aggregate.
function keywordFallback(
  q: ClassifyQuestionInput,
  catalogue: CatalogueEntry[],
): ClassifyResult | null {
  const qTok = new Set(tokens(questionText(q)));
  if (qTok.size === 0) return null;
  let best: { t: CatalogueEntry; score: number } | null = null;
  for (const t of catalogue) {
    const text = [t.title, t.learning_outcomes.join(" "), t.knowledge_outcomes.join(" ")].join(" ");
    let score = 0;
    for (const tok of tokens(text)) if (qTok.has(tok)) score++;
    if (!best || score > best.score) best = { t, score };
  }
  if (!best || best.score < 2) return null;
  return {
    topic_code: best.t.topic_code,
    learning_outcomes: best.t.learning_outcomes.slice(0, 3),
    knowledge_outcomes: best.t.knowledge_outcomes.slice(0, 3),
    ao_codes: best.t.ao_codes.slice(0, 2),
    bloom_level: null,
  };
}

export type ClassifyOptions = {
  batchSize?: number;       // default 6
  concurrency?: number;     // default 3
  primaryModel?: string;    // default flash
  fallbackModel?: string;   // default flash-lite
  timeoutMs?: number;       // default 60s per batch
};

export type ClassifyOutcome = {
  classifications: Record<string, ClassifyResult>;
  classified: number;
  total: number;
  via_ai: number;
  via_fallback: number;
  failed_batches: number;
};

export async function classifyQuestionsBatched(
  questions: ClassifyQuestionInput[],
  catalogue: CatalogueEntry[],
  subject: string,
  level: string,
  opts: ClassifyOptions = {},
): Promise<ClassifyOutcome> {
  const batchSize = opts.batchSize ?? 6;
  const concurrency = opts.concurrency ?? 3;
  const primary = opts.primaryModel ?? "google/gemini-2.5-flash";
  const fallback = opts.fallbackModel ?? "google/gemini-2.5-flash-lite";
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const batches: ClassifyQuestionInput[][] = [];
  for (let i = 0; i < questions.length; i += batchSize) batches.push(questions.slice(i, i + batchSize));

  const result: Record<string, ClassifyResult> = {};
  let viaAi = 0;
  let failed = 0;

  // Simple bounded concurrency over batches.
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      try {
        const out = await classifyBatch(batch, catalogue, subject, level, primary, timeoutMs);
        let got = Object.keys(out).length;
        if (got === 0) {
          // Retry once with the lighter model.
          const out2 = await classifyBatch(batch, catalogue, subject, level, fallback, timeoutMs);
          for (const [k, v] of Object.entries(out2)) { result[k] = v; viaAi++; }
          got = Object.keys(out2).length;
          if (got === 0) failed++;
        } else {
          for (const [k, v] of Object.entries(out)) { result[k] = v; viaAi++; }
        }
      } catch (e) {
        console.warn(`[classify] batch ${idx} primary failed:`, (e as Error).message);
        try {
          const out = await classifyBatch(batch, catalogue, subject, level, fallback, timeoutMs);
          for (const [k, v] of Object.entries(out)) { result[k] = v; viaAi++; }
          if (Object.keys(out).length === 0) failed++;
        } catch (e2) {
          console.warn(`[classify] batch ${idx} fallback failed:`, (e2 as Error).message);
          failed++;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));

  // Fill remaining gaps with deterministic keyword match.
  let viaFallback = 0;
  for (const q of questions) {
    if (result[q.number]) continue;
    const guess = keywordFallback(q, catalogue);
    if (guess) { result[q.number] = guess; viaFallback++; }
  }

  const classified = Object.keys(result).length;
  console.log(`[classify] ${classified}/${questions.length} classified (${viaAi} ai, ${viaFallback} fallback, ${failed} failed batches of ${batches.length})`);

  return {
    classifications: result,
    classified,
    total: questions.length,
    via_ai: viaAi,
    via_fallback: viaFallback,
    failed_batches: failed,
  };
}
