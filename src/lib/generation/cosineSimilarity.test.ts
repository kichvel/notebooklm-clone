// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './overviewIntent';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it('is invariant to vector magnitude', () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 1], [100, 100])).toBeCloseTo(1, 10);
  });
});
