// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildYoutubeTimestampUrl } from './index';

describe('buildYoutubeTimestampUrl', () => {
  it('appends a t= query param in whole seconds', () => {
    expect(buildYoutubeTimestampUrl('https://www.youtube.com/watch?v=abc123XYZ_-', 90.7)).toBe(
      'https://www.youtube.com/watch?v=abc123XYZ_-&t=90s',
    );
  });

  it('preserves existing query params', () => {
    expect(
      buildYoutubeTimestampUrl('https://www.youtube.com/watch?v=abc123XYZ_-&list=PL1', 5),
    ).toBe('https://www.youtube.com/watch?v=abc123XYZ_-&list=PL1&t=5s');
  });
});
