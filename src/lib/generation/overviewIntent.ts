import 'server-only';

// Recognizes a small, fixed set of "meta" questions that ask about the notebook's sources as a
// whole (e.g. "what are the sources about", "summarize all sources") rather than asking a
// specific factual question that happens to mention "sources" in passing. This is intentionally
// a narrow template match, not a general intent classifier: ordinary questions always fall
// through to normal semantic retrieval unchanged.
const OVERVIEW_QUESTION_PATTERNS: RegExp[] = [
  /^what (?:are|is) the sources? about\??$/,
  /^what (?:are|is) (?:this notebook|the notebook) about\??$/,
  /^(?:summarize|summarise) (?:the contents of )?(?:all|every|each of the)? ?sources?(?: in (?:this|the) notebook)?\.?$/,
  /^(?:summarize|summarise) (?:this|the) notebook\.?$/,
  /^(?:give me |can you give me )?(?:an )?overview of (?:this notebook|the notebook|all(?: the)? sources|everything(?: in this notebook)?)\.?$/,
  /^what do(?:es)? (?:this notebook|all(?: the)? sources) (?:contain|cover)\??$/,
  /^what'?s in this notebook\??$/,
];

function normalize(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isNotebookOverviewQuestion(question: string): boolean {
  const normalized = normalize(question);
  return OVERVIEW_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
