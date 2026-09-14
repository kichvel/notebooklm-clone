import { describe, expect, it } from 'vitest';
import { FOLLOWUPS_DELIMITER, FALLBACK_FOLLOW_UP_QUESTIONS, parseFollowUps } from './followUps';

describe('parseFollowUps', () => {
  it('splits the answer from three well-formed follow-up questions', () => {
    const raw = `Cats are mammals [1].${FOLLOWUPS_DELIMITER}What do cats eat?\n- Where do cats live?\n1. How long do cats live?`;
    const { text, followUpQuestions } = parseFollowUps(raw);
    expect(text).toBe('Cats are mammals [1].');
    expect(followUpQuestions).toEqual([
      'What do cats eat?',
      'Where do cats live?',
      'How long do cats live?',
    ]);
  });

  it('falls back to generic questions when the delimiter is missing', () => {
    const { text, followUpQuestions } = parseFollowUps('Cats are mammals [1].');
    expect(text).toBe('Cats are mammals [1].');
    expect(followUpQuestions).toEqual(FALLBACK_FOLLOW_UP_QUESTIONS);
  });

  it('falls back to generic questions when fewer than three are parsed', () => {
    const raw = `Cats are mammals [1].${FOLLOWUPS_DELIMITER}Only one question?`;
    expect(parseFollowUps(raw).followUpQuestions).toEqual(FALLBACK_FOLLOW_UP_QUESTIONS);
  });
});
