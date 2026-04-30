// Curated Singapore MOE syllabus topics (MVP set)
export const SUBJECTS = [
  "Humanities",
  "Sciences",
] as const;

export const LEVELS = [
  "Sec 1", "Sec 2",
  "Sec 3", "Sec 4",
  "Sec 3N", "Sec 4N", "Sec 5N",
] as const;

export const ASSESSMENT_TYPES = [
  { id: "formative", label: "Formative quiz" },
  { id: "topical", label: "Topical test" },
  { id: "weighted_assessment", label: "Weighted Assessment (WA)" },
  { id: "alternative_assessment", label: "Alternative Assessment" },
  { id: "mid_year", label: "Mid-year exam" },
  { id: "end_of_year", label: "End-of-Year Exam (EYE)" },
  { id: "prelim", label: "Prelim" },
  { id: "mock", label: "Mock paper" },
] as const;

export const QUESTION_TYPES = [
  { id: "mcq", label: "Multiple choice" },
  { id: "short_answer", label: "Short answer" },
  { id: "structured", label: "Structured" },
  { id: "long", label: "Long answer / Essay" },
  { id: "comprehension", label: "Comprehension" },
  { id: "practical", label: "Practical" },
  { id: "source_based", label: "Source-based" },
  { id: "spoken_response", label: "Spoken response" },
  { id: "listening_mcq", label: "Listening MCQ" },
  { id: "note_taking", label: "Note-taking" },
  { id: "summary", label: "Summary writing" },
] as const;

// Default question types per assessment mode (for oral/listening/practical papers)
export const QUESTION_TYPES_BY_MODE: Record<string, string[]> = {
  written: ["mcq", "short_answer", "structured", "long"],
  oral: ["spoken_response"],
  listening: ["listening_mcq", "note_taking", "summary"],
  practical: ["practical", "structured"],
};

export const ITEM_SOURCES = [
  { id: "ai", label: "AI-generated" },
  { id: "bank", label: "My question bank" },
  { id: "upload", label: "From references" },
] as const;

export const BLOOMS = [
  "Remember", "Understand", "Apply", "Analyse", "Evaluate", "Create",
] as const;

type TopicMap = Record<string, Record<string, string[]>>;

export const TOPICS: TopicMap = {
  Mathematics: {
    P1: ["Numbers to 100", "Addition & Subtraction", "Shapes", "Length", "Time", "Money"],
    P2: ["Numbers to 1000", "Multiplication & Division", "Fractions", "Mass & Volume", "Picture Graphs"],
    P3: ["Numbers to 10 000", "Mental Calculation", "Money", "Time", "Length & Mass", "Bar Graphs", "Angles"],
    P4: ["Whole Numbers", "Factors & Multiples", "Fractions", "Decimals", "Area & Perimeter", "Symmetry", "Tables & Line Graphs"],
    P5: ["Whole Numbers", "Fractions", "Decimals", "Percentage", "Average", "Rate", "Area of Triangle", "Ratio", "Volume"],
    P6: ["Algebra", "Fractions", "Ratio", "Percentage", "Speed", "Circles", "Pie Charts", "Volume", "Geometry"],
    "Sec 1": ["Numbers & Operations", "Algebraic Expressions", "Equations & Inequalities", "Functions & Graphs", "Geometry", "Mensuration", "Statistics"],
    "Sec 2": ["Indices", "Algebraic Manipulation", "Linear Graphs", "Quadratic Equations", "Pythagoras' Theorem", "Trigonometry", "Probability"],
    "Sec 3": ["Quadratic Functions", "Indices & Surds", "Coordinate Geometry", "Trigonometry", "Vectors", "Probability", "Statistical Diagrams"],
    "Sec 4": ["Sets", "Matrices", "Vectors", "Probability", "Statistical Analysis", "Geometric Properties of Circles"],
  },
  Science: {
    P3: ["Diversity of Living Things", "Materials", "Magnets"],
    P4: ["Life Cycles", "Matter", "Heat & Temperature", "Light"],
    P5: ["Cells", "Plant System", "Human System", "Electricity", "Water Cycle"],
    P6: ["Energy", "Forces", "Reproduction", "Adaptations", "Interactions in Environment"],
    "Sec 1": ["Scientific Inquiry", "Cells", "Diversity of Matter", "Energy", "Forces"],
    "Sec 2": ["Human Reproduction", "Transport in Living Things", "Chemical Changes", "Electricity"],
    "Sec 3": ["Atomic Structure", "Chemical Bonding", "Acids & Bases", "Genetics", "Ecology"],
    "Sec 4": ["Organic Chemistry", "Electrochemistry", "Homeostasis", "Waves", "Electromagnetism"],
  },
  "English Language": {
    P3: ["Comprehension", "Grammar", "Vocabulary", "Composition"],
    P4: ["Comprehension", "Grammar", "Synthesis", "Composition"],
    P5: ["Comprehension Open-Ended", "Editing", "Grammar Cloze", "Composition"],
    P6: ["Comprehension Open-Ended", "Editing", "Grammar Cloze", "Synthesis & Transformation", "Composition"],
    "Sec 1": ["Comprehension", "Editing", "Visual Text", "Situational Writing", "Continuous Writing"],
    "Sec 2": ["Comprehension", "Editing", "Visual Text", "Situational Writing", "Continuous Writing"],
    "Sec 3": ["Comprehension", "Summary", "Visual Text", "Situational Writing", "Continuous Writing"],
    "Sec 4": ["Comprehension", "Summary", "Visual Text", "Situational Writing", "Continuous Writing"],
  },
  "Mother Tongue": {
    P3: ["语文应用", "阅读理解", "作文"],
    P4: ["语文应用", "阅读理解", "作文"],
    P5: ["语文应用", "阅读理解", "作文"],
    P6: ["语文应用", "阅读理解", "作文"],
  },
  Humanities: {
    "Sec 1": ["Geography: Living with Tectonic Hazards", "History: Singapore Pre-1819", "Social Studies: Citizenship"],
    "Sec 2": ["Geography: Variable Weather", "History: Singapore 1819-1965", "Social Studies: Diversity"],
    "Sec 3": ["Geography: Tourism", "History: WWII", "Social Studies: Living in a Diverse Society"],
    "Sec 4": ["Geography: Food Resources", "History: Cold War", "Social Studies: Managing International Relations"],
  },
};

export function topicsFor(subject: string, level: string): string[] {
  return TOPICS[subject]?.[level] ?? [];
}
