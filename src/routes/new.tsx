import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  SUBJECTS, LEVELS, ASSESSMENT_TYPES, QUESTION_TYPES, QUESTION_TYPES_BY_MODE, BLOOMS, topicsFor,
} from "@/lib/syllabus";
import {
  loadSyllabusLibrary, loadPaperTopics, loadDocTopics, loadDocAssessmentObjectives,
  loadDocSkillsOutcomes,
  type SyllabusLibraryDoc, type SyllabusLibraryPaper, type PaperTopic, type AssessmentObjective,
  type SkillsOutcome,
} from "@/lib/syllabus-data";
import {
  type Section, type SectionTopic, type SectionedBlueprint, type DifficultyMix,
  defaultSection, nextSectionLetter, blueprintTotalMarks, isScienceSubject,
  difficultyMixTotal, DEFAULT_DIFFICULTY_MIX,
  SBQ_SKILLS, MAX_SBQ_SKILLS, getSectionSkills, isHumanitiesSubject, type SbqSkill,
} from "@/lib/sections";
import { ChevronLeft, ChevronRight, Sparkles, Loader2, BookOpen, Upload, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { BuilderCoachPanel } from "@/components/BuilderCoachPanel";
import { BuilderUploadCard } from "@/components/BuilderUploadCard";
import type { BuilderSnapshot } from "@/lib/intent-coach";

export const Route = createFileRoute("/new")({
  component: NewAssessment,
  head: () => ({ meta: [{ title: "Create assessment · origAImi" }] }),
});

type BlueprintRow = {
  topic: string;
  bloom: string;
  marks: number;
  topic_code?: string | null;
  section?: string | null;
  learning_outcomes?: string[];
  ao_codes?: string[];
  outcome_categories?: string[];
};
type Blueprint = BlueprintRow[];

type Band = "primary" | "secondary";
type Stream = "standard" | "foundation" | "g3" | "g2";

// Social Studies (2260/2261/2262) Knowledge Outcomes — these are the three
// "Issues" that scope the syllabus. Picking these locks both SBQ and SRQ
// sections to a coherent theme so the case-study sources and essay questions
// stay aligned to the same Issue.
const DEFAULT_SOCIAL_STUDIES_KOS: string[] = [
  "Issue 1: Exploring Citizenship and Governance",
  "Issue 2: Living in a Diverse Society",
  "Issue 3: Living in a Globalised World",
];

const DEFAULT_SOCIAL_STUDIES_SOS: SkillsOutcome[] = [
  { code: "SO1", statement: "examine societal issues critically by gathering, interpreting, analysing and evaluating information from different sources to make well-reasoned and substantiated arguments, recommendations and conclusions on societal issues" },
  { code: "SO2", statement: "demonstrate sound reasoning and responsible decision-making that considers Singapore's unique contexts, constraints and vulnerabilities; and the consequences of one's actions on those around them" },
  { code: "SO3", statement: "demonstrate perspective-taking when encountering differing views" },
  { code: "SO4", statement: "demonstrate reflective thinking when reviewing their understanding of societal issues and examining personal assumptions and beliefs about others" },
];

function isSocialStudiesPaper(doc?: SyllabusLibraryDoc | null, paper?: SyllabusLibraryPaper | null): boolean {
  const haystack = [doc?.subject, doc?.title, doc?.syllabusCode, paper?.componentName, paper?.paperCode, paper?.topicTheme]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("social studies") || /\b226[0-2]\/01\b/.test(haystack);
}

function classifyLevel(level?: string | null): { band: Band; stream: Stream } | null {
  if (!level) return null;
  const l = level.toLowerCase();
  if (l.startsWith("p")) {
    return { band: "primary", stream: l.includes("foundation") ? "foundation" : "standard" };
  }
  if (l.startsWith("sec") || l.startsWith("s")) {
    // "Sec 4N" / "Sec 4 N(A)" → G2; everything else secondary → G3 (covers G3/Express/O-Level)
    const isNA = /\b(n\(a\)|na|n\b|4n|3n)/i.test(level);
    return { band: "secondary", stream: isNA ? "g2" : "g3" };
  }
  return null;
}

function matchesBandStream(level: string | null | undefined, band: Band, stream: Stream): boolean {
  const c = classifyLevel(level);
  if (!c) return false;
  return c.band === band && c.stream === stream;
}

const STREAMS_FOR_BAND: Record<Band, { id: Stream; label: string }[]> = {
  primary: [
    { id: "standard", label: "Standard (PSLE)" },
    { id: "foundation", label: "Foundation" },
  ],
  secondary: [
    { id: "g3", label: "G3" },
    { id: "g2", label: "G2" },
  ],
};


function NewAssessment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [startMode, setStartMode] = useState<"scratch" | "upload">("scratch");
  const [busy, setBusy] = useState(false);

  // Step 1 / basics — auto-filled when a syllabus paper is selected
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [level, setLevel] = useState<string>("Sec 1");
  const [aType, setAType] = useState<string>("topical");
  const [duration, setDuration] = useState(60);
  const [totalMarks, setTotalMarks] = useState(50);

  // Syllabus library
  const [library, setLibrary] = useState<SyllabusLibraryDoc[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [selectedPaperKey, setSelectedPaperKey] = useState<string>(""); // `${docId}:${paperId}`
  const [paperTopics, setPaperTopics] = useState<PaperTopic[]>([]);
  const [docAOs, setDocAOs] = useState<AssessmentObjective[]>([]);
  const [docSOs, setDocSOs] = useState<SkillsOutcome[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [streamFilter, setStreamFilter] = useState<Stream>("standard");

  useEffect(() => {
    let cancelled = false;
    loadSyllabusLibrary()
      .then((docs) => { if (!cancelled) setLibrary(docs); })
      .catch((e) => toast.error(e.message ?? "Could not load syllabus library"))
      .finally(() => { if (!cancelled) setLibLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Derived band from the chosen Level (P* → primary, Sec/S* → secondary).
  const userBand: Band = useMemo(() => classifyLevel(level)?.band ?? "primary", [level]);

  // When the level's band changes, snap the stream to a valid choice for that band.
  useEffect(() => {
    const valid = STREAMS_FOR_BAND[userBand].map((s) => s.id);
    if (!valid.includes(streamFilter)) setStreamFilter(STREAMS_FOR_BAND[userBand][0].id);
  }, [userBand, streamFilter]);

  // Filter the syllabus library by subject + level-band + stream.
  const filteredLibrary = useMemo(() => {
    return library.filter((d) => {
      if (!d.level) return false;
      const c = classifyLevel(d.level);
      if (!c) return false;
      if (c.band !== userBand) return false;
      if (c.stream !== streamFilter) return false;
      if (subject && d.subject) {
        const a = d.subject.toLowerCase();
        const b = subject.toLowerCase();
        if (!a.includes(b) && !b.includes(a)) return false;
      }
      return true;
    });
  }, [library, subject, userBand, streamFilter]);

  // If the current selection no longer matches the active filter, clear it.
  useEffect(() => {
    if (!selectedPaperKey) return;
    const [docId] = selectedPaperKey.split(":");
    if (!filteredLibrary.some((d) => d.id === docId)) setSelectedPaperKey("");
  }, [filteredLibrary, selectedPaperKey]);

  // Suggested difficulty mix derived from the most relevant specimen paper's
  // fingerprint (Bloom mix → easy/medium/hard buckets). Pegs the builder to
  // the calibrated specimens (e.g. Cambridge GCE) for the chosen subject+level.
  const [specimenMix, setSpecimenMix] = useState<DifficultyMix | null>(null);
  const [specimenLabel, setSpecimenLabel] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    if (!isScienceSubject(subject)) { setSpecimenMix(null); setSpecimenLabel(""); return; }
    (async () => {
      const { data } = await supabase
        .from("past_papers")
        .select("title, year, level, subject, difficulty_fingerprint")
        .ilike("subject", `%${subject}%`)
        .ilike("level", `%${level}%`)
        .not("difficulty_fingerprint", "is", null)
        .order("year", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = data?.[0] as { title?: string; year?: number; difficulty_fingerprint?: { bloom_mix_pct?: Record<string, number> } } | undefined;
      const bm = row?.difficulty_fingerprint?.bloom_mix_pct;
      if (!bm) { setSpecimenMix(null); setSpecimenLabel(""); return; }
      // Map Bloom → difficulty buckets.
      const easy = Math.round((bm.remember ?? 0) + (bm.understand ?? 0) * 0.5);
      const hard = Math.round((bm.analyse ?? 0) + (bm.evaluate ?? 0) + (bm.create ?? 0));
      const medium = Math.max(0, 100 - easy - hard);
      setSpecimenMix({ easy, medium, hard });
      setSpecimenLabel(`${row?.title ?? "specimen"}${row?.year ? ` (${row.year})` : ""}`);
    })();
    return () => { cancelled = true; };
  }, [subject, level]);

  const selected = useMemo(() => {
    if (!selectedPaperKey) return null;
    const [docId, paperId] = selectedPaperKey.split(":");
    const doc = library.find((d) => d.id === docId);
    const paper = doc?.papers.find((p) => p.id === paperId);
    if (!doc || !paper) return null;
    return { doc, paper };
  }, [selectedPaperKey, library]);

  const useSyllabus = !!selected;
  const socialStudiesPaper = isSocialStudiesPaper(selected?.doc, selected?.paper);
  const effectiveDocSOs = useMemo(
    () => (socialStudiesPaper && docSOs.length === 0 ? DEFAULT_SOCIAL_STUDIES_SOS : docSOs),
    [socialStudiesPaper, docSOs],
  );

  // When the selected paper changes, load its topics + prefill metadata.
  // For multi-track MCQ papers (e.g. 5086/01) topics live on sibling
  // track-specific papers — fall back to loading all doc topics, which
  // the section sub-selector then narrows down.
  useEffect(() => {
    if (!selected) {
      setPaperTopics([]);
      setDocAOs([]);
      setDocSOs([]);
      return;
    }
    const { doc, paper } = selected;
    if (doc.subject) setSubject(doc.subject);
    if (doc.level) setLevel(doc.level);
    if (paper.durationMinutes) setDuration(paper.durationMinutes);
    if (paper.marks) setTotalMarks(paper.marks);
    setTopicsLoading(true);
    Promise.all([
      loadPaperTopics(paper.id).then(async (t) => {
        // Fallback to doc-level topics when the paper has none of its own.
        // This covers multi-track papers (e.g. Combined Sci) AND syllabi
        // where topics are shared across all papers (e.g. History 2261/2126).
        if (t.length === 0) {
          return loadDocTopics(doc.id);
        }
        return t;
      }),
      loadDocAssessmentObjectives(doc.id),
      loadDocSkillsOutcomes(doc.id).catch(() => []),
    ])
      .then(([t, aos, sos]) => {
        setPaperTopics(t);
        setDocAOs(aos);
        setDocSOs(sos);
      })
      .catch((e) => toast.error(e.message ?? "Could not load topics"))
      .finally(() => setTopicsLoading(false));
  }, [selected]);

  // Step 2 — topic selection
  const fallbackTopics = useMemo(() => topicsFor(subject, level), [subject, level]);

  // Section sub-selector (for multi-track papers like Combined Science 5086).
  // For combined papers we expose an extra "All" pseudo-section so teachers can
  // pull topics from both disciplines (e.g. Physics + Chemistry) into the same
  // paper instead of being forced to pick one.
  const ALL_SECTIONS = "All";
  const availableSections = useMemo(() => {
    if (!selected) return [];
    const tags = selected.paper.trackTags ?? [];
    let base: string[] = [];
    if (tags.length > 1) {
      base = tags.map((t) => t.charAt(0).toUpperCase() + t.slice(1));
    } else {
      const fromTopics = Array.from(new Set(paperTopics.map((t) => t.section).filter((s): s is string => !!s)));
      if (fromTopics.length > 1) base = fromTopics;
    }
    return base.length > 1 ? [ALL_SECTIONS, ...base] : base;
  }, [selected, paperTopics]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  useEffect(() => {
    // Default to "All" on combined papers so both subjects' topics are visible.
    if (availableSections.length > 0) setActiveSection(availableSections[0]);
    else setActiveSection(selected?.paper.section ?? null);
  }, [availableSections, selected]);

  // For syllabus mode, only pick leaf-ish topics, optionally filtered by active section.
  // When activeSection === "All", show topics from every section.
  const selectableSyllabusTopics = useMemo(() => {
    let pool = paperTopics.filter((t) => t.depth >= 1 || paperTopics.every((x) => x.depth === 0));
    if (availableSections.length > 0 && activeSection && activeSection !== ALL_SECTIONS) {
      pool = pool.filter((t) => !t.section || t.section.toLowerCase() === activeSection.toLowerCase());
    }
    return pool;
  }, [paperTopics, availableSections, activeSection]);

  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]); // fallback (non-syllabus) topic names

  useEffect(() => {
    setSelectedTopicIds([]);
    setTopics([]);
  }, [selectedPaperKey, subject, level, activeSection]);

  // Topics step has been removed — auto-select every available topic so the
  // section builder always has the full pool to choose from.
  useEffect(() => {
    if (useSyllabus) {
      setSelectedTopicIds(selectableSyllabusTopics.map((t) => t.id));
    } else {
      setTopics(fallbackTopics.slice());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSyllabus, selectableSyllabusTopics.length, fallbackTopics.length]);

  // Step 2.5 — Objectives (AOs / KOs / LOs).
  // Globally chosen targets the paper must hit; each section can later narrow them.
  const [selectedAoCodes, setSelectedAoCodes] = useState<string[]>([]);
  const [selectedKos, setSelectedKos] = useState<string[]>([]);
  const [selectedLos, setSelectedLos] = useState<string[]>([]);
  const [customLoInput, setCustomLoInput] = useState("");

  // LO union derived from currently-selected topics (deduped, capped for UI).
  const derivedLos = useMemo(() => {
    if (useSyllabus) {
      const set = new Set<string>();
      for (const t of selectableSyllabusTopics) {
        if (!selectedTopicIds.includes(t.id)) continue;
        for (const lo of t.learningOutcomes ?? []) {
          const trimmed = lo.trim();
          if (trimmed) set.add(trimmed);
        }
      }
      return Array.from(set);
    }
    return [];
  }, [useSyllabus, selectableSyllabusTopics, selectedTopicIds]);

  // KO categories derived from the topics the teacher actually picked in Step 2.
  // Each syllabus defines its own KO vocabulary (e.g. History uses
  // knowledge/skills/values/attitudes), so we surface whatever the topics carry
  // rather than forcing a fixed bucket list.
  const availableKos = useMemo(() => {
    if (!useSyllabus) return [] as string[];
    // For Social Studies (2260/2261/2262), the only valid KO categories are
    // the three Issues. Topics may carry generic "Knowledge"/"Skills"/"Values"
    // bucket labels — those must NOT appear as KO checkboxes.
    if (socialStudiesPaper) return DEFAULT_SOCIAL_STUDIES_KOS.slice();
    const seen = new Map<string, string>(); // lower -> original casing
    for (const t of selectableSyllabusTopics) {
      if (!selectedTopicIds.includes(t.id)) continue;
      for (const c of t.outcomeCategories ?? []) {
        const trimmed = c.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (!seen.has(key)) seen.set(key, trimmed);
      }
    }
    return Array.from(seen.values());
  }, [useSyllabus, socialStudiesPaper, selectableSyllabusTopics, selectedTopicIds]);

  // Reset objective picks whenever topics change, keeping any custom LOs the
  // teacher typed (anything not in derivedLos is preserved as custom).
  useEffect(() => {
    setSelectedAoCodes((prev) => prev.filter((c) => docAOs.some((a) => a.code === c)));
    setSelectedKos((prev) => prev.filter((k) => availableKos.includes(k)));
    setSelectedLos((prev) => {
      // keep selections that are still derivable OR were custom (not in derivedLos)
      const derivedSet = new Set(derivedLos);
      return prev.filter((lo) => derivedSet.has(lo) || !derivedLos.includes(lo));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docAOs, availableKos.join("|"), derivedLos.join("|")]);

  const addCustomLo = () => {
    const v = customLoInput.trim();
    if (!v) return;
    setSelectedLos((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setCustomLoInput("");
  };

  // Step 3 — sections (replaces old blueprint + question types steps)
  const [sections, setSections] = useState<Section[]>([]);

  // Auto-seed a default Section A when topics are first picked, but only if user
  // hasn't created sections yet. Also clear sections when the topic pool is reset.
  useEffect(() => {
    const pickedTopicsCount = useSyllabus ? selectedTopicIds.length : topics.length;
    if (pickedTopicsCount === 0) {
      setSections([]);
      return;
    }
    if (sections.length === 0) {
      const seedType = (QUESTION_TYPES_BY_MODE[selected?.paper.assessmentMode ?? "written"] ?? ["structured"])[0] ?? "structured";
      const masterPool: SectionTopic[] = useSyllabus
        ? selectableSyllabusTopics
            .filter((t) => selectedTopicIds.includes(t.id))
            .map((t) => ({
              topic: t.topicCode ? `${t.topicCode} · ${t.title}` : t.title,
              topic_code: t.topicCode,
              learning_outcomes: t.learningOutcomes,
              ao_codes: t.aoCodes,
              outcome_categories: t.outcomeCategories,
              section: t.section,
              strand: t.strand,
              sub_strand: t.subStrand,
              learning_outcome_code: t.learningOutcomeCode,
            }))
        : topics.map((t) => ({ topic: t }));
      // Seed a sensible question count: MCQ defaults to 1 mark per question
      // (so num_questions = totalMarks); other formats start near the marks
      // budget rather than the topic pool size, so a 40-mark paper doesn't
      // open with "97 questions" just because the syllabus pool is large.
      const seedCount = seedType === "mcq"
        ? Math.max(1, totalMarks)
        : Math.max(1, Math.min(masterPool.length, Math.ceil(totalMarks / 4)));
      if (socialStudiesPaper) {
        const defaultSkills: SbqSkill[] = ["inference", "comparison", "reliability", "purpose", "assertion"];
        setSections([
          {
            ...defaultSection("A", 35),
            name: "Source-Based Case Study",
            question_type: "source_based",
            marks: Math.min(35, totalMarks),
            num_questions: 5,
            topic_pool: masterPool,
            sbq_skills: defaultSkills,
            sbq_skill: undefined,
            ao_codes: selectedAoCodes.slice(),
            knowledge_outcomes: selectedKos.slice(),
            learning_outcomes: selectedLos.slice(),
          },
          {
            ...defaultSection("B", Math.max(1, totalMarks - Math.min(35, totalMarks))),
            name: "Structured Response Questions",
            question_type: "long",
            marks: Math.max(1, totalMarks - Math.min(35, totalMarks)),
            num_questions: 2,
            topic_pool: masterPool,
            ao_codes: selectedAoCodes.slice(),
            knowledge_outcomes: selectedKos.slice(),
            learning_outcomes: selectedLos.slice(),
          },
        ]);
        return;
      }
      setSections([{
        ...defaultSection("A", totalMarks),
        question_type: seedType,
        num_questions: seedCount,
        topic_pool: masterPool,
        ao_codes: selectedAoCodes.slice(),
        knowledge_outcomes: selectedKos.slice(),
        learning_outcomes: selectedLos.slice(),
      }]);
    }
    // intentionally no `sections` dep — only seed when pool first becomes non-empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopicIds, topics, useSyllabus, selected?.paper.assessmentMode, socialStudiesPaper]);

  // The full master pool of topics available to any section (derived from Step 2 selection).
  const masterTopicPool: SectionTopic[] = useMemo(() => {
    if (useSyllabus) {
      return selectableSyllabusTopics
        .filter((t) => selectedTopicIds.includes(t.id))
        .map((t) => ({
          topic: t.topicCode ? `${t.topicCode} · ${t.title}` : t.title,
          topic_code: t.topicCode,
          learning_outcomes: t.learningOutcomes,
          ao_codes: t.aoCodes,
          outcome_categories: t.outcomeCategories,
          section: t.section,
          strand: t.strand,
          sub_strand: t.subStrand,
          learning_outcome_code: t.learningOutcomeCode,
        }));
    }
    return topics.map((t) => ({ topic: t }));
  }, [useSyllabus, selectableSyllabusTopics, selectedTopicIds, topics]);

  const sectionsTotalMarks = blueprintTotalMarks({ sections });
  const totalQuestions = sections.reduce((acc, s) => acc + (s.num_questions || 0), 0);
  const assessmentMode = selected?.paper.assessmentMode ?? "written";

  const visibleQuestionTypes = useMemo(() => {
    const allowedIds = QUESTION_TYPES_BY_MODE[assessmentMode] ?? QUESTION_TYPES_BY_MODE.written;
    if (assessmentMode === "written") {
      return QUESTION_TYPES.filter((t) => !["spoken_response", "listening_mcq", "note_taking"].includes(t.id));
    }
    return QUESTION_TYPES.filter((t) => allowedIds.includes(t.id));
  }, [assessmentMode]);

  const updateSection = (id: string, patch: Partial<Section>) => {
    setSections((sx) => sx.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const addSection = () => {
    const remaining = Math.max(1, totalMarks - sectionsTotalMarks);
    setSections((sx) => [...sx, {
      ...defaultSection(nextSectionLetter(sx), remaining),
      topic_pool: masterTopicPool,
      ao_codes: selectedAoCodes.slice(),
      knowledge_outcomes: selectedKos.slice(),
      learning_outcomes: selectedLos.slice(),
    }]);
  };
  const removeSection = (id: string) => {
    setSections((sx) => {
      const next = sx.filter((s) => s.id !== id);
      // Re-letter A, B, C…
      return next.map((s, i) => ({ ...s, letter: String.fromCharCode(65 + i) }));
    });
  };
  const moveSection = (id: string, dir: -1 | 1) => {
    setSections((sx) => {
      const i = sx.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sx.length) return sx;
      const next = [...sx];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, k) => ({ ...s, letter: String.fromCharCode(65 + k) }));
    });
  };

  // Step 4 — references / instructions
  const [referenceNote, setReferenceNote] = useState("");

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const canNext = () => {
    if (step === 1) {
      if (libLoading) return false;
      if (library.length > 0 && !selected) return false;
      return title.trim().length > 0;
    }
    if (step === 2) {
      // Assessment Builder: require a valid section blueprint.
      if (sections.length === 0) return false;
      if (sectionsTotalMarks !== totalMarks) return false;
      if (sections.some((s) => s.topic_pool.length === 0 || s.num_questions < 1)) return false;
      // For Science subjects, any section with a difficulty_mix must sum to 100.
      if (isScienceSubject(subject)) {
        if (sections.some((s) => s.difficulty_mix && difficultyMixTotal(s.difficulty_mix) !== 100)) return false;
      }
      return true;
    }
    return true;
  };

  const handleGenerate = async () => {
    setBusy(true);
    const blueprintForDb: SectionedBlueprint = { sections };
    const allTopics = Array.from(new Set(sections.flatMap((s) => s.topic_pool.map((t) => t.topic))));
    const allQTypes = Array.from(new Set(sections.map((s) => s.question_type)));

    const { data: created, error: e1 } = await supabase
      .from("assessments")
      .insert({
        user_id: user.id,
        title, subject, level,
        assessment_type: aType,
        duration_minutes: duration,
        total_marks: totalMarks,
        status: "generating",
        topics: allTopics,
        blueprint: blueprintForDb as unknown as never,
        question_types: allQTypes,
        item_sources: ["ai"],
        instructions: referenceNote || null,
        syllabus_doc_id: selected?.doc.id ?? null,
        syllabus_paper_id: selected?.paper.id ?? null,
        syllabus_code: selected?.paper.paperCode ?? selected?.doc.syllabusCode ?? null,
      })
      .select()
      .single();

    if (e1 || !created) {
      setBusy(false);
      return toast.error(e1?.message ?? "Could not create assessment");
    }

    // Kick off generation but DO NOT await — the edge function can run longer
    // than the API gateway's 150s timeout. The assessment editor page polls
    // status + questions and surfaces partial / final results as they appear.
    void supabase.functions
      .invoke("generate-assessment", {
        body: {
          assessmentId: created.id,
          userId: user.id,
          title, subject, level,
          assessmentType: aType,
          durationMinutes: duration,
          totalMarks,
          topics: allTopics,
          blueprint: blueprintForDb,
          objectives: {
            ao_codes: selectedAoCodes,
            knowledge_outcomes: selectedKos,
            learning_outcomes: selectedLos,
          },
          questionTypes: allQTypes,
          itemSources: ["ai"],
          instructions: referenceNote,
          syllabusCode: selected?.doc.syllabusCode ?? null,
          paperCode: selected?.paper.paperCode ?? null,
        },
      })
      .catch((err) => {
        // Gateway timeout (504) is expected for long generations — the worker
        // keeps running and the editor page will pick up rows via polling.
        // Only log; never block the navigation or scare the user with a toast.
        console.warn("[generate-assessment] invoke threw (likely gateway timeout)", err);
      });

    setBusy(false);
    toast.success("Drafting your paper… questions will appear as they are ready.");
    navigate({ to: "/assessment/$id", params: { id: created.id } });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className={`mx-auto px-4 py-8 sm:px-6 ${step === 1 ? "max-w-3xl" : "max-w-6xl"}`}>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-paper text-2xl font-semibold tracking-tight">
            New assessment
          </h1>
          
        </div>

        <Stepper step={step} />

        {step === 1 && (
          <div className="mt-8 rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              How do you want to start?
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setStartMode("scratch")}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  startMode === "scratch"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-medium">Build from scratch</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Pick syllabus, topics, sections, then generate questions.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setStartMode("upload")}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  startMode === "upload"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-medium">Upload an existing paper</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Continue setting a draft PDF and run the Assessment Coach.
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 1 && startMode === "upload" ? (
          <div className="mt-6">
            <BuilderUploadCard defaultSubject={subject} defaultLevel={level} />
          </div>
        ) : (
        <div className={step === 1 ? "" : "mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"}>
        <div className={step === 1 ? "mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8" : "rounded-2xl border border-border bg-card p-6 sm:p-8"}>
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-paper text-xl font-semibold">Basics</h2>

              {/* 1. Subject + Level — these scope the syllabus picker below */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select value={subject} onValueChange={setSubject}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      {selected?.doc.subject && !SUBJECTS.includes(selected.doc.subject as typeof SUBJECTS[number]) && (
                        <SelectItem value={selected.doc.subject}>{selected.doc.subject}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Level</Label>
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      {selected?.doc.level && !LEVELS.includes(selected.doc.level as typeof LEVELS[number]) && (
                        <SelectItem value={selected.doc.level}>{selected.doc.level}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 2. Posting Group — narrows within the band derived from Level */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">POSTING GROUP</span>
                <SegmentedFilter
                  options={STREAMS_FOR_BAND[userBand]}
                  value={streamFilter}
                  onChange={(v) => setStreamFilter(v as Stream)}
                />
              </div>

              {/* 3. Syllabus paper picker (filtered by subject + level-band + stream) */}
              {libLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your syllabus library…
                </div>
              ) : library.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    <Upload className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 text-sm">
                      <p className="font-medium">Upload a syllabus to unlock code-tagged topics.</p>
                      <p className="mt-1 text-muted-foreground">
                        For now we'll use the curated MOE topic map. Your subject and level above will guide the draft.
                      </p>
                      <Button asChild variant="outline" size="sm" className="mt-3">
                        <Link to="/admin/syllabus">Go to syllabus library</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>
                    Syllabus
                  </Label>
                  <Select value={selectedPaperKey} onValueChange={setSelectedPaperKey}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick the syllabus + paper to align to…" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredLibrary.length === 0 ? (
                        <div className="px-3 py-2 text-xs italic text-muted-foreground">
                          No syllabuses uploaded for this subject + level + posting group yet.
                        </div>
                      ) : filteredLibrary.map((doc) => (
                        <div key={doc.id}>
                          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {doc.syllabusCode ? `${doc.syllabusCode} · ` : ""}{doc.title}
                            {doc.syllabusYear ? ` (${doc.syllabusYear})` : ""}
                          </div>
                          {doc.papers.length === 0 ? (
                            <div className="px-3 py-1.5 text-xs italic text-muted-foreground">No parsed papers yet</div>
                          ) : doc.papers.map((p) => (
                            <SelectItem key={p.id} value={`${doc.id}:${p.id}`}>
                              {paperLabel(p)}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                  {selected && (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        Auto-filled from{" "}
                        <span className="font-medium text-foreground">
                          {selected.paper.paperCode ?? selected.doc.syllabusCode}
                        </span>.
                      </p>
                      {selected.paper.assessmentMode && selected.paper.assessmentMode !== "written" && (
                        <Badge variant="outline" className="capitalize">{selected.paper.assessmentMode}</Badge>
                      )}
                      {selected.paper.section && (
                        <Badge variant="secondary">{selected.paper.section}</Badge>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 4. Title + assessment metadata */}
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder={selected ? `${selected.doc.subject ?? ""} ${selected.doc.level ?? ""} — ${selected.paper.componentName ?? ""}`.trim() : "P5 Mathematics — Topical Test (Fractions)"} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Assessment type</Label>
                  <Select value={aType} onValueChange={setAType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASSESSMENT_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="duration">Duration (min)</Label>
                    <Input id="duration" type="number" min={10} value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="marks">Total marks</Label>
                    <Input id="marks" type="number" min={5} value={totalMarks}
                      onChange={(e) => setTotalMarks(Number(e.target.value))} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-paper text-xl font-semibold">Assessment Builder</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Build each section with its own question type, marks, and AOs/LOs. Total marks must equal {totalMarks}.
                </p>
              </div>

              {sections.length === 0 && (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  Pick topics in the previous step first, then add a section here.
                </div>
              )}

              {sections.map((s, i) => (
                <SectionCard
                  key={s.id}
                  section={s}
                  isFirst={i === 0}
                  isLast={i === sections.length - 1}
                  masterPool={masterTopicPool}
                  visibleQuestionTypes={visibleQuestionTypes}
                  subject={subject}
                  allAOs={docAOs}
                  availableSos={socialStudiesPaper ? effectiveDocSOs : []}
                  availableKos={socialStudiesPaper ? DEFAULT_SOCIAL_STUDIES_KOS : []}

                  globalAoCodes={selectedAoCodes}
                  globalKos={selectedKos}
                  globalLos={selectedLos}
                  specimenMix={specimenMix}
                  specimenLabel={specimenLabel}
                  onUpdate={(patch) => updateSection(s.id, patch)}
                  onRemove={() => removeSection(s.id)}
                  onMove={(d) => moveSection(s.id, d)}
                />
              ))}

              {masterTopicPool.length > 0 && (
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={addSection} className="gap-1">
                    <Plus className="h-4 w-4" /> Add section
                  </Button>
                  <div className={`text-sm font-medium ${sectionsTotalMarks === totalMarks ? "text-success" : "text-destructive"}`}>
                    Total: {sectionsTotalMarks} / {totalMarks} marks · {totalQuestions} question{totalQuestions === 1 ? "" : "s"}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-paper text-xl font-semibold">Special Instructions</h2>
              <p className="text-sm text-muted-foreground">
                Optional: describe any style cues, past-paper patterns, or special instructions for the AI.
              </p>
              <Textarea rows={6} value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)}
                placeholder="e.g. Mimic 2023 PSLE Math style. Use Singapore hawker contexts. SI units." />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-primary" />
              <h2 className="font-paper text-2xl font-semibold">Ready to draft</h2>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                We'll write {totalQuestions} questions across {sections.length} section{sections.length === 1 ? "" : "s"} ({totalMarks} marks).
                You'll be able to edit, regenerate, and refine every question.
              </p>
              <ul className="mx-auto inline-flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                {selected?.paper.paperCode && <Badge variant="default">{selected.paper.paperCode}</Badge>}
                <Badge variant="secondary">{subject}</Badge>
                <Badge variant="secondary">{level}</Badge>
                <Badge variant="secondary">{duration} min</Badge>
                <Badge variant="secondary">{totalMarks} marks</Badge>
                {sections.map((s) => (
                  <Badge key={s.id} variant="outline">
                    {s.letter}: {QUESTION_TYPES.find((q) => q.id === s.question_type)?.label ?? s.question_type} ({s.num_questions}×)
                  </Badge>
                ))}
              </ul>
              <Button size="lg" className="mt-4 gap-2" onClick={handleGenerate} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {busy ? "Drafting..." : "Generate assessment"}
              </Button>
            </div>
          )}
        </div>

        {step >= 2 && (
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <BuilderCoachPanel
              snapshot={{
                step: step as 2 | 3 | 4,
                subject,
                level,
                syllabusCode: selected?.doc.syllabusCode ?? null,
                syllabusDocId: selected?.doc.id ?? null,
                paperCode: selected?.paper.paperCode ?? null,
                assessmentMode: selected?.paper.assessmentMode ?? "written",
                totalMarks,
                duration,
                sections,
                referenceNote,
                paperAOs: docAOs,
                selectedAoCodes,
                selectedKos,
                selectedLos,
                topicPoolSize: useSyllabus ? selectedTopicIds.length : topics.length,
              } satisfies BuilderSnapshot}
              onAppendInstructions={(text) =>
                setReferenceNote((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text))
              }
            />
          </aside>
        )}
        </div>
        )}

        {!(step === 1 && startMode === "upload") && (
          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" disabled={step === 1 || busy}
              onClick={() => setStep((s) => Math.max(1, s - 1))} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            {step < 4 ? (
              <Button disabled={!canNext()} onClick={() => setStep((s) => s + 1)} className="gap-1">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            ) : <span />}
          </div>
        )}

      </main>
    </div>
  );
}

function paperLabel(p: SyllabusLibraryPaper) {
  const bits = [`Paper ${p.paperNumber}`];
  if (p.paperCode) bits.push(p.paperCode);
  if (p.componentName) bits.push(p.componentName);
  if (p.section) bits.push(p.section);
  const meta: string[] = [];
  if (p.assessmentMode && p.assessmentMode !== "written") {
    meta.push(p.assessmentMode.charAt(0).toUpperCase() + p.assessmentMode.slice(1));
  }
  if (p.marks) meta.push(`${p.marks}m`);
  if (p.durationMinutes) {
    const h = Math.floor(p.durationMinutes / 60);
    const m = p.durationMinutes % 60;
    meta.push(h > 0 ? `${h}h${m ? m : ""}` : `${m}min`);
  }
  return bits.join(" · ") + (meta.length ? ` (${meta.join(", ")})` : "");
}

function Stepper({ step }: { step: number }) {
  const labels = ["Basics", "Assessment Builder", "Special Instructions", "Generate"];
  return (
    <div className="w-full">
      {/* Row of circles + connectors */}
      <div className="flex items-center">
        {labels.map((l, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          const isLast = n === labels.length;
          return (
            <div key={l} className="flex flex-1 items-center last:flex-none">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/15"
                    : done
                    ? "bg-success text-success-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {done ? "✓" : n}
              </div>
              {!isLast && (
                <div
                  className={`mx-2 h-px flex-1 transition-colors sm:mx-3 ${
                    done ? "bg-success/60" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Row of labels aligned under each circle */}
      <div className="mt-2 hidden sm:flex">
        {labels.map((l, i) => {
          const n = i + 1;
          const active = n === step;
          const isLast = n === labels.length;
          return (
            <div
              key={l}
              className={`flex items-start ${isLast ? "" : "flex-1"}`}
            >
              <span
                className={`w-8 shrink-0 text-center text-[11px] leading-tight ${
                  active ? "text-foreground font-medium" : "text-muted-foreground"
                }`}
                style={{ marginLeft: "-6px", marginRight: "-6px", minWidth: "5rem" }}
              >
                {l}
              </span>
              {!isLast && <div className="mx-2 flex-1 sm:mx-3" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedFilter({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-background p-0.5">
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const AO_COLORS: Record<string, string> = {
  AO1: "bg-chart-1",
  AO2: "bg-chart-2",
  AO3: "bg-chart-3",
  AO4: "bg-chart-4",
  AO5: "bg-chart-5",
  Unmapped: "bg-muted-foreground/40",
};
const CAT_COLORS: Record<string, string> = {
  knowledge: "bg-chart-1",
  skills: "bg-chart-2",
  values: "bg-chart-3",
  attitudes: "bg-chart-4",
  Unmapped: "bg-muted-foreground/40",
};

function BlueprintTable({
  blueprint,
  totalMarks,
  blueprintSum,
  paperAOs,
  aosAreSyllabusWide,
  onUpdate,
}: {
  blueprint: Blueprint;
  totalMarks: number;
  blueprintSum: number;
  paperAOs: AssessmentObjective[];
  aosAreSyllabusWide?: boolean;
  onUpdate: (i: number, patch: Partial<BlueprintRow>) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { row: BlueprintRow; index: number }[]>();
    blueprint.forEach((row, index) => {
      const key = row.section?.trim() || "General";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ row, index });
    });
    return Array.from(map.entries());
  }, [blueprint]);

  const aoOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { code: string; title?: string | null }[] = [];
    for (const a of paperAOs) {
      if (seen.has(a.code)) continue;
      seen.add(a.code);
      opts.push({ code: a.code, title: a.title });
    }
    if (opts.length === 0) {
      for (const r of blueprint) {
        for (const c of r.ao_codes ?? []) {
          if (seen.has(c)) continue;
          seen.add(c);
          opts.push({ code: c });
        }
      }
    }
    return opts;
  }, [paperAOs, blueprint]);

  const toggleAO = (rowIndex: number, code: string) => {
    const current = blueprint[rowIndex]?.ao_codes ?? [];
    const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
    onUpdate(rowIndex, { ao_codes: next });
  };

  return (
    <div className="space-y-4">
      {aosAreSyllabusWide && paperAOs.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Note:</span> AOs for this syllabus are weighted across the whole paper, not tied to individual questions. Use the tags below to indicate which AO each row is <em>primarily</em> targeting — the generator will balance the overall mix.
        </div>
      )}
      {groups.map(([sectionName, rows]) => (
        <div key={sectionName} className="overflow-hidden rounded-lg border border-border">
          {groups.length > 1 && (
            <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {sectionName}
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 w-[45%]">Topic</th>
                <th className="px-3 py-2">Assessment Objectives</th>
                <th className="px-3 py-2 text-right w-[90px]">Marks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, index }) => {
                const selected = row.ao_codes ?? [];
                return (
                  <tr key={index} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      {row.topic_code && (
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">{row.topic_code}</span>
                      )}
                      <span>{row.topic.replace(`${row.topic_code} · `, "")}</span>
                    </td>
                    <td className="px-3 py-2">
                      {aoOptions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No AOs published for this paper</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {aoOptions.map((ao) => {
                            const active = selected.includes(ao.code);
                            return (
                              <button
                                type="button"
                                key={ao.code}
                                onClick={() => toggleAO(index, ao.code)}
                                title={ao.title ?? undefined}
                                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                  active
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                                }`}
                              >
                                {ao.code}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={1}
                        value={row.marks}
                        className="ml-auto h-8 w-20 text-right"
                        onChange={(e) => onUpdate(index, { marks: Number(e.target.value) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className={`flex items-center justify-end gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium ${blueprintSum === totalMarks ? "text-success" : "text-destructive"}`}>
        <span className="text-muted-foreground">Total marks</span>
        <span className="tabular-nums">{blueprintSum} / {totalMarks}</span>
      </div>
    </div>
  );
}

function CoverageStrips({ blueprint, aos }: { blueprint: Blueprint; aos: AssessmentObjective[] }) {
  const aoMarks: Record<string, number> = {};
  const catMarks: Record<string, number> = {};
  let totalMarks = 0;
  for (const row of blueprint) {
    const m = row.marks || 0;
    totalMarks += m;
    const codes = row.ao_codes && row.ao_codes.length > 0 ? row.ao_codes : ["Unmapped"];
    const share = m / codes.length;
    for (const c of codes) aoMarks[c] = (aoMarks[c] ?? 0) + share;
    const cats = row.outcome_categories && row.outcome_categories.length > 0 ? row.outcome_categories : ["Unmapped"];
    const catShare = m / cats.length;
    for (const k of cats) catMarks[k] = (catMarks[k] ?? 0) + catShare;
  }

  const hasAOs = aos.length > 0;
  const publishedAOs = Array.from(new Set(aos.map((a) => a.code)));
  const missingAOs = hasAOs ? publishedAOs.filter((c) => !aoMarks[c] || aoMarks[c] === 0) : [];

  const warnings: string[] = [];
  if (hasAOs && totalMarks > 0) {
    for (const code of publishedAOs) {
      const published = aos.find((a) => a.code === code)?.weightingPercent;
      if (published == null) continue;
      const actualPct = ((aoMarks[code] ?? 0) / totalMarks) * 100;
      const diff = Math.abs(actualPct - published);
      if (diff > 15) {
        warnings.push(`${code}: ${actualPct.toFixed(0)}% vs published ${published}% (off by ${diff.toFixed(0)}%)`);
      }
    }
  }
  if (missingAOs.length > 0) warnings.push(`Not addressed: ${missingAOs.join(", ")}`);

  if (totalMarks === 0) return null;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Assessment Objective coverage</h3>
          {!hasAOs && <span className="text-xs text-muted-foreground">No AOs published for this syllabus</span>}
        </div>
        <Bar segments={Object.entries(aoMarks).map(([code, m]) => ({
          label: code,
          value: m,
          color: AO_COLORS[code] ?? "bg-chart-5",
        }))} total={totalMarks} />
        {hasAOs && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {aos.map((a) => {
              const actualPct = totalMarks > 0 ? ((aoMarks[a.code] ?? 0) / totalMarks) * 100 : 0;
              return (
                <div key={a.id} className="flex items-baseline gap-2">
                  <span className="font-mono font-medium text-foreground">{a.code}</span>
                  {a.title && <span className="truncate">{a.title}</span>}
                  <span className="ml-auto shrink-0 tabular-nums">
                    {actualPct.toFixed(0)}%{a.weightingPercent != null ? ` / target ${a.weightingPercent}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Knowledge / Skills / Values coverage</h3>
        <Bar segments={Object.entries(catMarks).map(([k, m]) => ({
          label: k,
          value: m,
          color: CAT_COLORS[k] ?? "bg-chart-5",
        }))} total={totalMarks} />
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {Object.entries(catMarks).map(([k, m]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-sm ${CAT_COLORS[k] ?? "bg-chart-5"}`} />
              <span className="capitalize">{k}</span>
              <span className="tabular-nums">{((m / totalMarks) * 100).toFixed(0)}%</span>
            </span>
          ))}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <p className="font-medium">Construct validity check</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

type SectionCardProps = {
  section: Section;
  isFirst: boolean;
  isLast: boolean;
  masterPool: SectionTopic[];
  visibleQuestionTypes: { id: string; label: string }[];
  subject: string;
  allAOs: AssessmentObjective[];
  availableSos?: SkillsOutcome[];
  availableKos?: string[];

  globalAoCodes: string[];
  globalKos: string[];
  globalLos: string[];
  specimenMix?: DifficultyMix | null;
  specimenLabel?: string;
  onUpdate: (patch: Partial<Section>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
};

function SectionCard({
  section, isFirst, isLast, masterPool, visibleQuestionTypes, subject,
  allAOs, availableSos = [], availableKos = [], globalAoCodes, globalKos, globalLos,
  specimenMix, specimenLabel,
  onUpdate, onRemove, onMove,
}: SectionCardProps) {
  const [customLo, setCustomLo] = useState("");
  const [customAo, setCustomAo] = useState("");

  const sectionAos = section.ao_codes ?? [];
  const sectionKos = section.knowledge_outcomes ?? [];
  const sectionLos = section.learning_outcomes ?? [];

  // AO candidates: union of syllabus AOs, global picks, anything already on this section.
  const aoCandidates = useMemo(() => {
    const map = new Map<string, { code: string; title?: string | null; description?: string | null }>();
    for (const a of allAOs) map.set(a.code, { code: a.code, title: a.title, description: a.description });
    for (const c of globalAoCodes) if (!map.has(c)) map.set(c, { code: c });
    for (const c of sectionAos) if (!map.has(c)) map.set(c, { code: c });
    return Array.from(map.values());
  }, [allAOs, globalAoCodes, sectionAos]);

  // KO candidates: union of outcome_categories across this section's topic pool,
  // plus the global KO picks and anything already on the section. Each syllabus
  // defines its own KO vocabulary (e.g. History uses knowledge/skills/values/
  // attitudes), so we surface whatever the topics actually carry.
  const koCandidates = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    };
    // SS papers: only the three Issues are valid KOs. Don't merge in topic-pool
    // outcome_categories (which include generic "Knowledge"/"Skills"/"Values"
    // buckets) or stale globalKos that came from non-SS topics.
    const isSocialStudiesKos =
      availableKos.length > 0 && availableKos.every((k) => /^issue\s*\d/i.test(k));
    if (isSocialStudiesKos) {
      for (const c of availableKos) add(c);
      // Preserve any already-selected SS issue on the section.
      for (const c of sectionKos) if (/^issue\s*\d/i.test(c)) add(c);
      return Array.from(seen.values());
    }
    for (const t of section.topic_pool) {
      for (const c of t.outcome_categories ?? []) add(c);
    }
    for (const c of availableKos) add(c);
    for (const c of globalKos) add(c);
    for (const c of sectionKos) add(c);
    return Array.from(seen.values());
  }, [section.topic_pool, globalKos, sectionKos, availableKos]);

  // LO candidates: union of (a) LOs from this section's topic_pool, (b) global LOs, (c) anything already on the section.
  // Fallback for syllabuses that publish only Skills Outcomes (e.g. Social
  // Studies papers in 2260/2261/2262 — Paper 1) — surface SOs as picks so the
  // box isn't empty.
  const loCandidates = useMemo(() => {
    const set = new Set<string>();
    if (availableSos.length > 0) {
      for (const so of availableSos) set.add(`${so.code}: ${so.statement}`);
      for (const lo of globalLos) set.add(lo);
      for (const lo of sectionLos) set.add(lo);
      return Array.from(set);
    }
    for (const t of section.topic_pool) {
      for (const lo of t.learning_outcomes ?? []) {
        const v = lo.trim();
        if (v) set.add(v);
      }
    }
    for (const lo of globalLos) set.add(lo);
    for (const lo of sectionLos) set.add(lo);
    return Array.from(set);
  }, [section.topic_pool, globalLos, sectionLos, availableSos]);

  const usingSoFallback = useMemo(() => {
    return availableSos.length > 0;
  }, [availableSos]);

  const toggleAo = (code: string) => {
    const next = sectionAos.includes(code) ? sectionAos.filter((c) => c !== code) : [...sectionAos, code];
    onUpdate({ ao_codes: next });
  };
  const toggleKo = (ko: string) => {
    const next = sectionKos.includes(ko) ? sectionKos.filter((c) => c !== ko) : [...sectionKos, ko];
    onUpdate({ knowledge_outcomes: next });
  };
  const toggleLo = (lo: string) => {
    const next = sectionLos.includes(lo) ? sectionLos.filter((c) => c !== lo) : [...sectionLos, lo];
    onUpdate({ learning_outcomes: next });
  };
  const addCustomAo = () => {
    const v = customAo.trim();
    if (!v) return;
    if (!sectionAos.includes(v)) onUpdate({ ao_codes: [...sectionAos, v] });
    setCustomAo("");
  };
  const addCustomLoLocal = () => {
    const v = customLo.trim();
    if (!v) return;
    if (!sectionLos.includes(v)) onUpdate({ learning_outcomes: [...sectionLos, v] });
    setCustomLo("");
  };

  const allAoSelected = aoCandidates.length > 0 && aoCandidates.every((a) => sectionAos.includes(a.code));
  const allKoSelected = koCandidates.length > 0 && koCandidates.every((k) => sectionKos.includes(k));
  const allLoSelected = loCandidates.length > 0 && loCandidates.every((l) => sectionLos.includes(l));
  const pickedKeys = new Set(section.topic_pool.map((t) => `${t.topic_code ?? ""}::${t.topic}`));
  const toggleTopic = (t: SectionTopic) => {
    const key = `${t.topic_code ?? ""}::${t.topic}`;
    const next = pickedKeys.has(key)
      ? section.topic_pool.filter((p) => `${p.topic_code ?? ""}::${p.topic}` !== key)
      : [...section.topic_pool, t];
    onUpdate({ topic_pool: next });
  };

  const showSbqSkill = section.question_type === "source_based" && isHumanitiesSubject(subject);
  const selectedSkills = getSectionSkills(section);
  const selectedSet = new Set<string>(selectedSkills);
  const atMax = selectedSkills.length >= MAX_SBQ_SKILLS;
  const hasAssertion = selectedSet.has("assertion");

  const toggleSkill = (skillId: SbqSkill) => {
    const isOn = selectedSet.has(skillId);
    let next: SbqSkill[];
    if (isOn) {
      next = selectedSkills.filter((s) => s !== skillId);
    } else {
      if (atMax) return;
      next = [...selectedSkills, skillId];
    }
    onUpdate({ sbq_skills: next, sbq_skill: undefined });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-base">Section {section.letter}</Badge>
          <Input
            className="h-8 w-56"
            placeholder="Section name (optional)"
            value={section.name ?? ""}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={isFirst} onClick={() => onMove(-1)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" disabled={isLast} onClick={() => onMove(1)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <Label className="text-xs">Question type</Label>
          <Select value={section.question_type} onValueChange={(v) => {
            if (v === "source_based") {
              // SEAB History/Social Studies SBQ sections present 5 sub-questions
              // built around 5 sources. Pre-fill a sensible default skill mix
              // (Inference → Comparison → Reliability → Purpose → Assertion)
              // and bump num_questions / marks so users don't have to.
              const defaultSkills: SbqSkill[] = ["inference", "comparison", "reliability", "purpose", "assertion"];
              onUpdate({
                question_type: v,
                num_questions: Math.max(5, section.num_questions),
                marks: Math.max(35, section.marks),
                sbq_skills: defaultSkills,
                sbq_skill: undefined,
              });
            } else {
              onUpdate({ question_type: v, sbq_skill: undefined, sbq_skills: undefined });
            }
          }}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {visibleQuestionTypes.map((q) => (
                <SelectItem key={q.id} value={q.id}>{q.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs"># Questions</Label>
          <Input type="number" min={1} className="h-9"
            value={section.num_questions}
            onChange={(e) => onUpdate({ num_questions: Math.max(1, parseInt(e.target.value || "1", 10)) })}
          />
        </div>
        <div>
          <Label className="text-xs">Total marks</Label>
          <Input type="number" min={1} className="h-9"
            value={section.marks}
            onChange={(e) => onUpdate({ marks: Math.max(1, parseInt(e.target.value || "1", 10)) })}
          />
        </div>
      </div>

      {showSbqSkill && (
        <div className="mt-3 rounded-md border border-primary/30 bg-primary-soft/20 p-3">
          <Label className="text-xs font-medium">SBQ Skills (History / Social Studies)</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Leave blank to let the AI choose, or pick up to {MAX_SBQ_SKILLS} skills. Selected skills will be distributed across the {section.num_questions} question(s) in this section.
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {SBQ_SKILLS.map((s) => {
              const checked = selectedSet.has(s.id);
              const disabled = !checked && atMax;
              return (
                <label
                  key={s.id}
                  title={disabled ? `Maximum ${MAX_SBQ_SKILLS} skills selected` : ""}
                  className={`flex cursor-pointer items-start gap-2 rounded p-1.5 text-xs ${
                    checked ? "bg-primary-soft/40" : disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={() => toggleSkill(s.id as SbqSkill)}
                  />
                  <span>
                    <span className="font-medium">{s.label}</span>{" "}
                    <span className="text-muted-foreground">
                      {s.locked ? `(${s.default}m, fixed)` : `(${s.marks.join("/")}m)`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {hasAssertion && (
            <p className="mt-2 text-xs text-primary">
              Assertion contributes 1 fixed 8-mark question using all sources; remaining questions split across other selected skills.
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {selectedSkills.length === 0
              ? "No skills selected — AI will use a generic SBQ format."
              : `${selectedSkills.length}/${MAX_SBQ_SKILLS} selected`}
          </p>
        </div>
      )}

      {isScienceSubject(subject) && (() => {
        const mix: DifficultyMix = section.difficulty_mix ?? { ...DEFAULT_DIFFICULTY_MIX };
        const total = difficultyMixTotal(mix);
        const ok = total === 100;
        const setMix = (next: DifficultyMix) => onUpdate({ difficulty_mix: next });
        const updateField = (k: keyof DifficultyMix, v: string) => {
          const n = Math.max(0, Math.min(100, parseInt(v || "0", 10) || 0));
          setMix({ ...mix, [k]: n });
        };
        return (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary-soft/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-medium">Difficulty mix</Label>
              <div className="flex items-center gap-3">
                {specimenMix && (
                  <button
                    type="button"
                    className="text-[11px] text-primary underline-offset-2 hover:underline"
                    onClick={() => setMix({ ...specimenMix })}
                    title={specimenLabel ? `From ${specimenLabel}` : undefined}
                  >
                    Apply specimen mix ({specimenMix.easy} / {specimenMix.medium} / {specimenMix.hard})
                  </button>
                )}
                <button
                  type="button"
                  className="text-[11px] text-primary underline-offset-2 hover:underline"
                  onClick={() => setMix({ ...DEFAULT_DIFFICULTY_MIX })}
                >
                  Reset to default (20 / 60 / 20)
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Sets the proportion of easy / medium / hard questions across the {section.num_questions} question(s) in this section. Must total 100%.
              {specimenMix && specimenLabel ? ` Suggested mix is calibrated against ${specimenLabel}.` : ""}
              </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Easy %</Label>
                <Input
                  type="number" min={0} max={100} className="h-9"
                  value={mix.easy}
                  onChange={(e) => updateField("easy", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Medium %</Label>
                <Input
                  type="number" min={0} max={100} className="h-9"
                  value={mix.medium}
                  onChange={(e) => updateField("medium", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Hard %</Label>
                <Input
                  type="number" min={0} max={100} className="h-9"
                  value={mix.hard}
                  onChange={(e) => updateField("hard", e.target.value)}
                />
              </div>
            </div>
            <p className={`mt-2 text-[11px] ${ok ? "text-muted-foreground" : "text-destructive"}`}>
              Total: {total}% {ok ? "✓" : "(must equal 100%)"}
            </p>
          </div>
        );
      })()}

      {/* Topic pool UI removed — topics are implied by the LOs picked below. */}

      {/* Per-section objectives */}
      <div className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-3">
        <Label className="text-xs font-semibold uppercase tracking-wide">Objectives for this section</Label>

        {/* Assessment Objectives — grouped by main AO band, expandable to sub-AOs */}
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Assessment Objectives (AOs)</Label>
            {aoCandidates.length > 0 && (
              <span className="text-xs text-muted-foreground">{sectionAos.length} / {aoCandidates.length} selected</span>
            )}
          </div>
          {aoCandidates.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No AOs available — add a custom one below.</p>
          ) : (
            <>
              {(() => {
                const allCodes = aoCandidates.map((a) => a.code);
                const allChecked = allCodes.length > 0 && allCodes.every((c) => sectionAos.includes(c));
                const someChecked = allCodes.some((c) => sectionAos.includes(c)) && !allChecked;
                return (
                  <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-2 text-xs font-medium hover:bg-muted/40">
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={() => onUpdate({ ao_codes: allChecked ? [] : allCodes })}
                    />
                    <span>{allChecked ? "Deselect all AOs" : "Select all AOs"}</span>
                  </label>
                );
              })()}
              <AOGroupedSelector
                aos={aoCandidates.map((a, idx) => ({
                  id: `${section.id}-${a.code}-${idx}`,
                  paperId: "",
                  code: a.code,
                  title: a.title ?? null,
                  description: a.description ?? null,
                  weightingPercent: null,
                  position: idx,
                }))}
                selected={sectionAos}
                onToggle={(code) => toggleAo(code)}
                onToggleMany={(codes, select) => {
                  const next = select
                    ? Array.from(new Set([...sectionAos, ...codes]))
                    : sectionAos.filter((c) => !codes.includes(c));
                  onUpdate({ ao_codes: next });
                }}
              />
            </>
          )}
          <div className="mt-2 flex gap-1.5">
            <Input
              className="h-7 text-xs"
              placeholder="+ Add custom AO (e.g. AO4)"
              value={customAo}
              onChange={(e) => setCustomAo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomAo(); } }}
            />
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addCustomAo} disabled={!customAo.trim()}>Add</Button>
          </div>
        </div>

        {/* Knowledge Outcomes (KOs) — for SS, these are the three Issues that
            scope the entire paper. Selecting them tightens both SBQ and SRQ
            generation to a coherent theme. */}
        {koCandidates.length > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Knowledge Outcomes (KOs)</Label>
              <span className="text-xs text-muted-foreground">{sectionKos.length} / {koCandidates.length} selected</span>
            </div>
            {availableKos.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pick the Issue(s) this section should target. Both SBQ sources and SRQ essays will be scoped to your selection.
              </p>
            )}
            {(() => {
              const allChecked = allKoSelected;
              const someChecked = koCandidates.some((k) => sectionKos.includes(k)) && !allChecked;
              return (
                <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-2 text-xs font-medium hover:bg-muted/40">
                  <Checkbox
                    checked={allChecked ? true : someChecked ? "indeterminate" : false}
                    onCheckedChange={() => onUpdate({ knowledge_outcomes: allChecked ? [] : koCandidates.slice() })}
                  />
                  <span>{allChecked ? "Deselect all KOs" : "Select all KOs"}</span>
                </label>
              );
            })()}
            <div className="mt-2 space-y-1">
              {koCandidates.map((ko) => {
                const checked = sectionKos.includes(ko);
                return (
                  <label
                    key={ko}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm transition-colors ${checked ? "border-primary bg-primary-soft/40" : "border-border hover:bg-muted/40"}`}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleKo(ko)} />
                    <span className="flex-1">{ko}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Learning Outcomes — grouped by topic, expandable */}
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              {usingSoFallback ? "Skills Outcomes (SO)" : "Learning Outcomes (LOs)"}
            </Label>
            <span className="text-xs text-muted-foreground">{sectionLos.length} / {loCandidates.length} selected</span>
          </div>
          {usingSoFallback && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              This syllabus paper defines Skills Outcomes (SO) instead of topic-level Learning Outcomes. Pick the SOs this section should target.
            </p>
          )}
          {loCandidates.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No LOs available — add a custom one below.</p>
          ) : (
            <>
              {(() => {
                const allChecked = loCandidates.length > 0 && loCandidates.every((lo) => sectionLos.includes(lo));
                const someChecked = loCandidates.some((lo) => sectionLos.includes(lo)) && !allChecked;
                return (
                  <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-2 text-xs font-medium hover:bg-muted/40">
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={() => onUpdate({ learning_outcomes: allChecked ? [] : loCandidates.slice() })}
                    />
                    <span>{allChecked ? `Deselect all ${usingSoFallback ? "SOs" : "LOs"}` : `Select all ${usingSoFallback ? "SOs" : "LOs"}`}</span>
                  </label>
                );
              })()}
              {usingSoFallback ? (
                <SOFlatSelector
                  items={loCandidates}
                  selected={sectionLos}
                  onToggle={(lo) => toggleLo(lo)}
                />
              ) : (
                <LOGroupedSelector
                  topics={section.topic_pool.map((t, idx) => ({
                    id: `${section.id}-topic-${idx}-${t.topic_code ?? t.topic}`,
                    paperId: "",
                    topicCode: t.topic_code ?? null,
                    parentCode: null,
                    title: t.topic,
                    depth: 0,
                    position: idx,
                    strand: t.strand ?? null,
                    subStrand: t.sub_strand ?? null,
                    learningOutcomes: t.learning_outcomes ?? [],
                    learningOutcomeCode: t.learning_outcome_code ?? null,
                    suggestedBlooms: [],
                    outcomeCategories: t.outcome_categories ?? [],
                    aoCodes: t.ao_codes ?? [],
                    section: t.section ?? null,
                    koContent: {},
                  }))}
                  selected={sectionLos}
                  onToggle={(lo) => toggleLo(lo)}
                  onToggleMany={(los, select) => {
                    const next = select
                      ? Array.from(new Set([...sectionLos, ...los]))
                      : sectionLos.filter((x) => !los.includes(x));
                    onUpdate({ learning_outcomes: next });
                  }}
                />
              )}
            </>
          )}
          <div className="mt-2 flex gap-1.5">
            <Input
              className="h-7 text-xs"
              placeholder="+ Add custom LO for this section"
              value={customLo}
              onChange={(e) => setCustomLo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomLoLocal(); } }}
            />
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addCustomLoLocal} disabled={!customLo.trim()}>Add</Button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Label className="text-xs">Section instructions (optional)</Label>
        <Textarea
          rows={2}
          className="text-sm"
          value={section.instructions ?? ""}
          onChange={(e) => onUpdate({ instructions: e.target.value })}
          placeholder="e.g. Answer all questions in this section."
        />
      </div>
    </div>
  );
}

function Bar({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {segments.map((s, i) => {
        const pct = (s.value / total) * 100;
        if (pct <= 0) return null;
        return (
          <div
            key={i}
            className={`${s.color} h-full transition-all`}
            style={{ width: `${pct}%` }}
            title={`${s.label}: ${pct.toFixed(0)}%`}
          />
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Grouped, collapsible Assessment-Objective selector.
// AO codes like "A1, A2, B1, C3" are grouped by their leading letter prefix
// (everything before the trailing digits). Codes like "AO1, AO2, AO3" group
// under the shared "AO" prefix.
// ─────────────────────────────────────────────────────────────────────────
function aoBandPrefix(code: string): string {
  const m = code.match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : code.toUpperCase();
}

function AOGroupedSelector({
  aos,
  selected,
  onToggle,
  onToggleMany,
}: {
  aos: AssessmentObjective[];
  selected: string[];
  onToggle: (code: string) => void;
  onToggleMany: (codes: string[], select: boolean) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, AssessmentObjective[]>();
    for (const ao of aos) {
      const key = aoBandPrefix(ao.code);
      const arr = m.get(key) ?? [];
      arr.push(ao);
      m.set(key, arr);
    }
    return Array.from(m.entries()).map(([prefix, items]) => ({ prefix, items }));
  }, [aos]);

  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="mt-3 space-y-2">
      {groups.map(({ prefix, items }) => {
        const codes = items.map((i) => i.code);
        const selectedInGroup = codes.filter((c) => selected.includes(c));
        const allChecked = codes.length > 0 && selectedInGroup.length === codes.length;
        const someChecked = selectedInGroup.length > 0 && !allChecked;
        const isOpen = !!open[prefix];
        return (
          <div key={prefix} className="rounded-md border border-border bg-background">
            <div className="flex items-center gap-2 p-2.5">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={() => onToggleMany(codes, !allChecked)}
                aria-label={`Select all ${prefix}`}
              />
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => setOpen((p) => ({ ...p, [prefix]: !isOpen }))}
              >
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <span className="font-mono text-sm font-semibold">{prefix}</span>
                <span className="text-xs text-muted-foreground">
                  {selectedInGroup.length} / {codes.length} selected
                </span>
              </button>
            </div>
            {isOpen && (
              <div className="border-t border-border p-2 space-y-1">
                {items.map((ao) => {
                  const checked = selected.includes(ao.code);
                  return (
                    <label
                      key={ao.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-2 transition-colors ${checked ? "border-primary bg-primary-soft/40" : "border-border hover:bg-muted/40"}`}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => onToggle(ao.code)} />
                      <div className="flex-1 text-sm">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono font-medium">{ao.code}</span>
                          {ao.title && <span className="text-foreground">{ao.title}</span>}
                          {ao.weightingPercent != null && (
                            <span className="ml-auto text-xs text-muted-foreground">[{ao.weightingPercent}%]</span>
                          )}
                        </div>
                        {ao.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{ao.description}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Grouped, collapsible Learning-Outcome selector. LOs are grouped by the
// topic they came from so teachers see topics first, then drill in.
// ─────────────────────────────────────────────────────────────────────────
function LOGroupedSelector({
  topics,
  selected,
  onToggle,
  onToggleMany,
}: {
  topics: PaperTopic[];
  selected: string[];
  onToggle: (lo: string) => void;
  onToggleMany: (los: string[], select: boolean) => void;
}) {
  // Dedupe LOs across topics — the same LO can appear under multiple topics;
  // we keep its first-seen topic grouping so the user picks once.
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: { topicId: string; title: string; los: string[]; section: string | null }[] = [];
    for (const t of topics) {
      const los: string[] = [];
      for (const raw of t.learningOutcomes ?? []) {
        const lo = raw.trim();
        if (!lo || seen.has(lo)) continue;
        seen.add(lo);
        los.push(lo);
      }
      if (los.length > 0) out.push({ topicId: t.id, title: t.title, los, section: t.section ?? null });
    }
    return out;
  }, [topics]);

  // Section buckets (e.g. Physics / Chemistry / Biology on Combined Science 5086/5087/5088,
  // or a single "Paper 1" bucket on a one-section MCQ paper). We always surface bulk
  // "Select all" controls so teachers can pick every LO in a section with one click.
  const sectionBuckets = useMemo(() => {
    const m = new Map<string, string[]>(); // section label -> LO list (preserves first-seen order)
    for (const g of groups) {
      if (!g.section) continue;
      const key = g.section;
      const arr = m.get(key) ?? [];
      arr.push(...g.los);
      m.set(key, arr);
    }
    return Array.from(m.entries()).map(([label, los]) => ({ label, los }));
  }, [groups]);

  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="mt-3 max-h-96 space-y-2 overflow-auto rounded-md border border-border bg-background p-2">
      {sectionBuckets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-dashed border-border bg-muted/30 p-2">
          <span className="self-center pr-1 text-xs font-medium text-muted-foreground">Quick pick:</span>
          {sectionBuckets.map(({ label, los }) => {
            const selectedCount = los.filter((lo) => selected.includes(lo)).length;
            const allChecked = los.length > 0 && selectedCount === los.length;
            return (
              <Button
                key={label}
                type="button"
                size="sm"
                variant={allChecked ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => onToggleMany(los, !allChecked)}
              >
                {allChecked ? `Deselect ${label}` : `${label} (select all)`}
                <span className="ml-1.5 text-[10px] opacity-70">{selectedCount}/{los.length}</span>
              </Button>
            );
          })}
        </div>
      )}
      {groups.map(({ topicId, title, los }) => {
        const selectedInGroup = los.filter((lo) => selected.includes(lo));
        const allChecked = los.length > 0 && selectedInGroup.length === los.length;
        const someChecked = selectedInGroup.length > 0 && !allChecked;
        const isOpen = !!open[topicId];
        return (
          <div key={topicId} className="rounded-md border border-border">
            <div className="flex items-center gap-2 p-2">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={() => onToggleMany(los, !allChecked)}
                aria-label={`Select all LOs for ${title}`}
              />
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => setOpen((p) => ({ ...p, [topicId]: !isOpen }))}
              >
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <span className="text-sm font-medium">{title}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {selectedInGroup.length} / {los.length}
                </span>
              </button>
            </div>
            {isOpen && (
              <div className="border-t border-border p-1.5 space-y-1">
                {los.map((lo) => {
                  const checked = selected.includes(lo);
                  return (
                    <label
                      key={lo}
                      className={`flex cursor-pointer items-start gap-2 rounded p-1.5 text-xs ${checked ? "bg-primary-soft/40" : "hover:bg-muted/40"}`}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => onToggle(lo)} />
                      <span className="flex-1">{lo}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Flat, expandable Skills Outcomes selector — used when the syllabus paper
// publishes SOs instead of topic-level LOs (e.g. Combined Humanities Social
// Studies Paper 1, 2260/2261/2262). Each SO row is a checkbox; the panel
// itself is collapsible so teachers can scan the full list.
// ─────────────────────────────────────────────────────────────────────────
function SOFlatSelector({
  items,
  selected,
  onToggle,
}: {
  items: string[];
  selected: string[];
  onToggle: (item: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const selectedCount = items.filter((i) => selected.includes(i)).length;
  return (
    <div className="mt-3 rounded-md border border-border bg-background">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="text-sm font-medium">Skills Outcomes</span>
        <span className="ml-auto text-xs text-muted-foreground">{selectedCount} / {items.length}</span>
      </button>
      {open && (
        <div className="max-h-96 space-y-1 overflow-auto border-t border-border p-2">
          {items.map((so) => {
            const checked = selected.includes(so);
            return (
              <label
                key={so}
                className={`flex cursor-pointer items-start gap-2 rounded p-1.5 text-xs ${checked ? "bg-primary-soft/40" : "hover:bg-muted/40"}`}
              >
                <Checkbox checked={checked} onCheckedChange={() => onToggle(so)} />
                <span className="flex-1">{so}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
