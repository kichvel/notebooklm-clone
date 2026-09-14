// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { embed, generateStreaming, REASONING_GENERATION_MODEL } from './openai';

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
