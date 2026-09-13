// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  type TranscriptResponse,
} from 'youtube-transcript';
import { extractVideoId, groupCuesIntoBlocks, youtubeAdapter } from './youtube';

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

describe('groupCuesIntoBlocks', () => {
  it('groups cues into ~30 second blocks carrying startSeconds', () => {
    const cues: TranscriptResponse[] = [
      { text: 'Hello', offset: 0, duration: 2 },
      { text: 'world', offset: 5, duration: 2 },
      { text: 'this is minute one', offset: 31, duration: 3 },
      { text: 'continuing', offset: 40, duration: 2 },
    ];

    const blocks = groupCuesIntoBlocks(cues);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ text: 'Hello world', startSeconds: 0 });
    expect(blocks[1]).toEqual({ text: 'this is minute one continuing', startSeconds: 31 });
  });

  it('returns an empty array for no cues', () => {
    expect(groupCuesIntoBlocks([])).toEqual([]);
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
