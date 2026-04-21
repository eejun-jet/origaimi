// Past-paper exemplar fetching: pulls parsed question stems + style summaries
// from `past_papers` matching subject + level, formats them as a prompt block
// to anchor question style, command-words, and difficulty.

interface ExemplarQuestion {
  number?: string | number;
  page?: number;
  command_word?: string;
  marks?: number;
  stem?: string;
  sub_parts?: Array<{ label?: string; text?: string; marks?: number }>;
}

interface ExemplarPaper {
  id: string;
  title: string;
  year: number | null;
  paper_number: string | null;
  exam_board: string | null;
  style_summary: string | null;
  questions_json: unknown;
}

const MAX_PAPERS = 3;
const MAX_QUESTIONS_PER_PAPER = 8;
const MAX_STEM_CHARS = 600;

export async function fetchExemplars(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2.49.0").createClient>,
  subject: string,
  level: string,
): Promise<{ block: string; paperCount: number; questionCount: number }> {
  if (!subject || !level) return { block: "", paperCount: 0, questionCount: 0 };

  const { data, error } = await supabase
    .from("past_papers")
    .select("id, title, year, paper_number, exam_board, style_summary, questions_json")
    .eq("subject", subject)
    .eq("level", level)
    .eq("parse_status", "ready")
    .not("questions_json", "is", null)
    .order("year", { ascending: false, nullsFirst: false })
    .limit(MAX_PAPERS);

  if (error || !data || data.length === 0) {
    return { block: "", paperCount: 0, questionCount: 0 };
  }

  const papers = data as ExemplarPaper[];
  let totalQ = 0;
  const sections: string[] = [];

  for (const p of papers) {
    const qs = Array.isArray(p.questions_json) ? (p.questions_json as ExemplarQuestion[]) : [];
    if (qs.length === 0 && !p.style_summary) continue;
    const sliced = qs.slice(0, MAX_QUESTIONS_PER_PAPER);
    totalQ += sliced.length;

    const header = `── PAPER: ${p.title}${p.year ? ` (${p.year})` : ""}${p.paper_number ? ` · P${p.paper_number}` : ""}${p.exam_board ? ` · ${p.exam_board}` : ""} ──`;
    const styleLine = p.style_summary ? `Style: ${p.style_summary.trim()}` : "";

    const qLines = sliced.map((q, i) => {
      const num = q.number ?? i + 1;
      const cw = q.command_word ? ` [${q.command_word}]` : "";
      const marks = typeof q.marks === "number" ? ` (${q.marks}m)` : "";
      const stem = (q.stem ?? "").trim().slice(0, MAX_STEM_CHARS);
      const subs = (q.sub_parts ?? [])
        .map((sp) => {
          const lbl = sp.label ? `(${sp.label}) ` : "";
          const sm = typeof sp.marks === "number" ? ` [${sp.marks}m]` : "";
          const txt = (sp.text ?? "").trim().slice(0, 240);
          return `   ${lbl}${txt}${sm}`;
        })
        .filter(Boolean)
        .join("\n");
      return `Q${num}${cw}${marks}: ${stem}${subs ? "\n" + subs : ""}`;
    });

    sections.push([header, styleLine, ...qLines].filter(Boolean).join("\n"));
  }

  if (sections.length === 0) return { block: "", paperCount: 0, questionCount: 0 };

  const block = `EXEMPLAR PAST PAPERS (use as STYLE/STRUCTURE/DIFFICULTY anchor — DO NOT copy verbatim):
${sections.join("\n\n")}

How to use the exemplars above:
- Match the command-word register (e.g. "Explain", "To what extent", "How far do you agree", "Compare").
- Match the structural format (sub-parts (a)(b)(c), source-based with stimulus, etc.).
- Match marks-per-question allocation patterns.
- Match the topical scope and difficulty norms shown.
- DO NOT reproduce any exemplar question, source text, or sub-part verbatim. Generate fresh content with the same register.`;

  return { block, paperCount: sections.length, questionCount: totalQ };
}
