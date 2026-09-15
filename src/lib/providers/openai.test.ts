// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  embed,
  generateFlashcards,
  generateFollowUpQuestions,
  generateQuizQuestions,
  generateStreaming,
  REASONING_GENERATION_MODEL,
} from './openai';

describe.skipIf(!process.env.OPENAI_API_KEY)('embed', () => {
  it('returns a 1536-dimension embedding vector', async () => {
    const vector = await embed('Sourcebook is a source-grounded AI knowledge workspace.');
    expect(vector).toHaveLength(1536);
    expect(vector.every((n) => typeof n === 'number')).toBe(true);
  }, 15000);
});

describe.skipIf(!process.env.OPENAI_API_KEY)('generateStreaming', () => {
  it('yields reasoning and answer deltas and completes', async () => {
    const chunks: { type: 'reasoning' | 'answer'; text: string }[] = [];
    for await (const chunk of generateStreaming({
      system: 'Answer in one short sentence.',
      prompt: 'What color is the sky on a clear day?',
      model: REASONING_GENERATION_MODEL,
    })) {
      chunks.push(chunk);
    }
    expect(chunks.some((c) => c.type === 'answer')).toBe(true);
    expect(chunks.map((c) => c.text).join('')).not.toHaveLength(0);
  }, 30000);
});

describe.skipIf(!process.env.OPENAI_API_KEY)('generateFollowUpQuestions', () => {
  it('returns exactly 3 non-empty follow-up questions', async () => {
    const questions = await generateFollowUpQuestions({
      system: 'Suggest 3 short follow-up questions a reader could ask next, based on the passage.',
      prompt: 'Passage: Cats are obligate carnivores and typically sleep 12-16 hours a day.',
    });
    expect(questions).toHaveLength(3);
    for (const q of questions) expect(q.trim().length).toBeGreaterThan(0);
  }, 15000);
});

describe.skipIf(!process.env.OPENAI_API_KEY)('generateFlashcards', () => {
  it('returns exactly 2 flashcards, each with non-empty front and back', async () => {
    const cards = await generateFlashcards({
      system:
        'Create two distinct study flashcards grounded ONLY in the passage below, each testing a different fact. "front" is a question or prompt; "back" is the answer.',
      prompt:
        'Passage: Cats are obligate carnivores and typically sleep 12-16 hours a day. They have retractable claws and excellent night vision.',
    });
    expect(cards).not.toBeNull();
    expect(cards).toHaveLength(2);
    for (const card of cards!) {
      expect(card.front.trim().length).toBeGreaterThan(0);
      expect(card.back.trim().length).toBeGreaterThan(0);
    }
  }, 15000);
});

describe.skipIf(!process.env.OPENAI_API_KEY)('generateQuizQuestions', () => {
  it('returns exactly 2 questions, each with 4 options and a valid correctIndex', async () => {
    const questions = await generateQuizQuestions({
      system:
        'Create two distinct multiple-choice questions, each with exactly 4 options, grounded ONLY in the passage below. Exactly one option per question is correct.',
      prompt:
        'Passage: Cats are obligate carnivores and typically sleep 12-16 hours a day. They have retractable claws and excellent night vision.',
    });
    expect(questions).not.toBeNull();
    expect(questions).toHaveLength(2);
    for (const question of questions!) {
      expect(question.question.trim().length).toBeGreaterThan(0);
      expect(question.options).toHaveLength(4);
      for (const o of question.options) expect(o.trim().length).toBeGreaterThan(0);
      expect(question.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question.correctIndex).toBeLessThanOrEqual(3);
    }
  }, 15000);
});
