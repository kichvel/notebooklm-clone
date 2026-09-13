// @vitest-environment node
import { NonRetriableError } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { YoutubeTranscript, YoutubeTranscriptDisabledError } from 'youtube-transcript';
import { extractVideoId, youtubeAdapter } from './youtube';

vi.mock('youtube-transcript', async () => {
  const actual = await vi.importActual<typeof import('youtube-transcript')>('youtube-transcript');
  return { ...actual, YoutubeTranscript: { fetchTranscript: vi.fn() } };
});

describe('extractVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc123XYZ_-', 'abc123XYZ_-'],
    ['https://youtu.be/abc123XYZ_-?t=30', 'abc123XYZ_-'],
    ['https://www.youtube.com/watch?v=abc123XYZ_-&list=PL1', 'abc123XYZ_-'],
  ])('extracts video id from %s', (url, expected) => {
    expect(extractVideoId(url)).toBe(expected);
  });

  it('returns null for a non-YouTube URL', () => {
    expect(extractVideoId('https://example.com/article')).toBeNull();
  });
});

describe('youtubeAdapter', () => {
  it('throws a non-retriable error when captions are disabled', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );

    await expect(
      youtubeAdapter.parse(undefined as never, {
        sourceId: 'source-1',
        storagePath: null,
        originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
      }),
    ).rejects.toThrow(NonRetriableError);
  });

  it('throws a non-retriable error when the transcript resolves with zero cues', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValue([]);

    await expect(
      youtubeAdapter.parse(undefined as never, {
        sourceId: 'source-1',
        storagePath: null,
        originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
      }),
    ).rejects.toThrow(/no available transcript/i);
  });

  it('produces timestamped blocks from a successful transcript fetch', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValue([
      { text: 'Intro line', offset: 0, duration: 2 },
    ]);

    const { blocks } = await youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    expect(blocks).toEqual([{ text: 'Intro line', startSeconds: 0 }]);
  });
});
