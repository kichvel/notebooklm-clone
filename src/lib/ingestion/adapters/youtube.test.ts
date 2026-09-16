// @vitest-environment node
import { NonRetriableError } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableLanguageError,
} from 'youtube-transcript';
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
  it('throws a retriable error (not NonRetriableError) when captions are disabled', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );

    const call = youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    await expect(call).rejects.toThrow(/couldn't retrieve a transcript/i);
    await expect(call).rejects.not.toBeInstanceOf(NonRetriableError);
  });

  it('throws a retriable error (not NonRetriableError) when the transcript resolves with zero cues', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValue([]);

    const call = youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    await expect(call).rejects.toThrow(/couldn't retrieve a transcript/i);
    await expect(call).rejects.not.toBeInstanceOf(NonRetriableError);
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
    expect(YoutubeTranscript.fetchTranscript).toHaveBeenCalledExactlyOnceWith('abc123XYZ_-', {
      lang: 'en',
    });
  });

  it('falls back to a machine-translated transcript when there is no native English track', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript)
      .mockRejectedValueOnce(
        new YoutubeTranscriptNotAvailableLanguageError('en', ['de'], 'abc123XYZ_-'),
      )
      .mockResolvedValueOnce([{ text: 'Translated line', offset: 0, duration: 2 }]);

    const { blocks } = await youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    expect(blocks).toEqual([{ text: 'Translated line', startSeconds: 0 }]);
    expect(YoutubeTranscript.fetchTranscript).toHaveBeenCalledTimes(2);
    expect(YoutubeTranscript.fetchTranscript).toHaveBeenNthCalledWith(1, 'abc123XYZ_-', {
      lang: 'en',
    });
    const secondCallConfig = vi.mocked(YoutubeTranscript.fetchTranscript).mock.calls[1][1];
    expect(secondCallConfig?.fetch).toBeInstanceOf(Function);
  });
});
