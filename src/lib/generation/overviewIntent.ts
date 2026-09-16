import 'server-only';

// Recognizes a small, fixed set of "meta" questions that ask about the notebook's sources as a
// whole (e.g. "what are the sources about", "summarize all sources") rather than asking a
// specific factual question that happens to mention "sources" in passing. This is intentionally
// a narrow template match, not a general intent classifier: ordinary questions always fall
// through to normal semantic retrieval unchanged.
const OVERVIEW_QUESTION_PATTERNS: RegExp[] = [
  /^what (?:are|is) the sources? about\??$/,
  /^what (?:are|is) (?:this notebook|the notebook) about\??$/,
  /^(?:summarize|summarise) (?:the contents of )?(?:all|every|each of the|the)? ?sources?\.?$/,
  /^(?:summarize|summarise) (?:this|the) notebook\.?$/,
  /^(?:give me |can you give me |please )?(?:a |an )?(?:brief |quick )?(?:summary|overview) of (?:this notebook|the notebook|all(?: the)? sources|every source|the sources?|everything)\.?$/,
  /^what do(?:es)? (?:the sources?|this notebook|the notebook) (?:contain|cover|discuss|talk about)\??$/,
  /^what'?s in (?:this|the) notebook\??$/,
];

// An inline clause like "in this notebook" or "of this notebook" is common padding on an
// otherwise-recognized template ("what are the sources in this notebook about?") and doesn't
// change the question's meaning. It's stripped on a second pass rather than destructively before
// all matching, since some templates (e.g. "what's in this notebook?") rely on that exact clause.
const NOTEBOOK_SCOPE_CLAUSE = /\b(?:in|of|for) (?:this|the) notebook\b/g;

function collapseWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ([.?!])/g, '$1') // e.g. "sources ." left behind by stripping a clause mid-sentence
    .trim();
}

export function isNotebookOverviewQuestion(question: string): boolean {
  const normalized = collapseWhitespace(question.trim().toLowerCase());
  const scopeStripped = collapseWhitespace(normalized.replace(NOTEBOOK_SCOPE_CLAUSE, ''));
  return OVERVIEW_QUESTION_PATTERNS.some(
    (pattern) => pattern.test(normalized) || pattern.test(scopeStripped),
  );
}
