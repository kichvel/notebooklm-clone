// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { embed } from './openai';

describe.skipIf(!process.env.OPENAI_API_KEY)('embed', () => {
  it(
    'returns a 1536-dimension embedding vector',
    async () => {
      const vector = await embed('Sourcebook is a source-grounded AI knowledge workspace.');
      expect(vector).toHaveLength(1536);
      expect(vector.every((n) => typeof n === 'number')).toBe(true);
    },
    15000,
  );
});
