// @vitest-environment node
import { Readable } from 'node:stream';
import { NonRetriableError } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { YoutubeTranscript, YoutubeTranscriptDisabledError } from 'youtube-transcript';
import { extractVideoId, youtubeAdapter } from './youtube';

vi.mock('youtube-transcript', async () => {
  const actual = await vi.importActual<typeof import('youtube-transcript')>('youtube-transcript');
  return { ...actual, YoutubeTranscript: { fetchTranscript: vi.fn() } };
});

vi.mock('@distube/ytdl-core', () => ({
  default: Object.assign(vi.fn(), { getInfo: vi.fn() }),
}));
vi.mock('@/lib/providers/openai', () => ({
  transcribeAudio: vi.fn(),
  MAX_TRANSCRIPTION_AUDIO_BYTES: 25 * 1024 * 1024,
}));

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
  it('throws a non-retriable error when captions are disabled and the audio fallback has no speech', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );
    const ytdl = (await import('@distube/ytdl-core')).default;
    vi.mocked(ytdl.getInfo).mockResolvedValue({} as never);
    vi.mocked(ytdl).mockReturnValue(Readable.from([Buffer.from('a'.repeat(1000))]) as never);
    const { transcribeAudio } = await import('@/lib/providers/openai');
    vi.mocked(transcribeAudio).mockResolvedValue([]);

    await expect(
      youtubeAdapter.parse(undefined as never, {
        sourceId: 'source-1',
        storagePath: null,
        originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
      }),
    ).rejects.toThrow(/could not transcribe any speech/i);
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

  it('falls back to audio transcription when captions are disabled', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );
    const ytdl = (await import('@distube/ytdl-core')).default;
    vi.mocked(ytdl.getInfo).mockResolvedValue({} as never);
    vi.mocked(ytdl).mockReturnValue(Readable.from([Buffer.from('a'.repeat(1000))]) as never);
    const { transcribeAudio } = await import('@/lib/providers/openai');
    vi.mocked(transcribeAudio).mockResolvedValue([{ start: 0, text: 'Fallback speech' }]);

    const { blocks } = await youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    expect(blocks).toEqual([{ text: 'Fallback speech', startSeconds: 0 }]);
  });

  it('falls back to audio transcription when the transcript resolves with zero cues', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValue([]);
    const ytdl = (await import('@distube/ytdl-core')).default;
    vi.mocked(ytdl.getInfo).mockResolvedValue({} as never);
    vi.mocked(ytdl).mockReturnValue(Readable.from([Buffer.from('a'.repeat(1000))]) as never);
    const { transcribeAudio } = await import('@/lib/providers/openai');
    vi.mocked(transcribeAudio).mockResolvedValue([{ start: 0, text: 'Fallback speech' }]);

    const { blocks } = await youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    expect(blocks).toEqual([{ text: 'Fallback speech', startSeconds: 0 }]);
  });

  it('throws non-retriably when fallback audio exceeds the size cap', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );
    const ytdl = (await import('@distube/ytdl-core')).default;
    vi.mocked(ytdl.getInfo).mockResolvedValue({} as never);
    vi.mocked(ytdl).mockReturnValue(Readable.from([Buffer.alloc(26 * 1024 * 1024)]) as never);

    await expect(
      youtubeAdapter.parse(undefined as never, {
        sourceId: 'source-1',
        storagePath: null,
        originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
      }),
    ).rejects.toThrow(NonRetriableError);
  });
});
