// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { embed, generateFollowUpQuestions, generateStreaming, REASONING_GENERATION_MODEL } from './openai';

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
