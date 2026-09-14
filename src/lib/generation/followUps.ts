import 'server-only';

export const FOLLOW_UP_COUNT = 3;
export const FOLLOWUPS_DELIMITER = '\n---FOLLOWUPS---\n';

export const FALLBACK_FOLLOW_UP_QUESTIONS = [
  'What are the key topics in these sources?',
  'Summarize the main points.',
  'What questions do these sources leave unanswered?',
];

export function followUpPromptInstruction(): string {
  return `After your response, on its own line write exactly "${FOLLOWUPS_DELIMITER.trim()}", then list exactly ${FOLLOW_UP_COUNT} short follow-up questions the user could ask next, one per line, with no numbering or bullets.`;
}

export function parseFollowUps(raw: string): { text: string; followUpQuestions: string[] } {
  const index = raw.indexOf(FOLLOWUPS_DELIMITER);
  if (index === -1) return { text: raw.trim(), followUpQuestions: FALLBACK_FOLLOW_UP_QUESTIONS };

  const text = raw.slice(0, index).trim();
  const followUpQuestions = raw
    .slice(index + FOLLOWUPS_DELIMITER.length)
    .split('\n')
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, FOLLOW_UP_COUNT);

  return {
    text,
    followUpQuestions:
      followUpQuestions.length === FOLLOW_UP_COUNT
        ? followUpQuestions
        : FALLBACK_FOLLOW_UP_QUESTIONS,
  };
}
