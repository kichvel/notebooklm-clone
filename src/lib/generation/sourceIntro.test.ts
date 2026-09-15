import { describe, expect, it } from 'vitest';
import { pickEvenlySpacedIndices } from './sourceIntro';

describe('pickEvenlySpacedIndices', () => {
  it('returns all indices when count is at or below the sample size', () => {
    expect(pickEvenlySpacedIndices(5, 12)).toEqual([0, 1, 2, 3, 4]);
  });

  it('spreads indices across the full range instead of clustering at the start', () => {
    const indices = pickEvenlySpacedIndices(40, 8);
    expect(indices).toHaveLength(8);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBeGreaterThanOrEqual(30);
    for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThan(indices[i - 1]);
  });
});
