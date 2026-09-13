// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NonRetriableError } from 'inngest';
import { audioAdapter } from './audio';
import * as openaiProvider from '@/lib/providers/openai';

vi.mock('@/lib/providers/openai', () => ({ transcribeAudio: vi.fn() }));

function fakeSupabase(blob: Blob | null) {
  return {
    storage: {
      from: () => ({
        download: vi.fn().mockResolvedValue({ data: blob, error: blob ? null : new Error('nope') }),
      }),
    },
  } as never;
}

describe('audioAdapter', () => {
  it('transcribes the downloaded original into timestamped blocks', async () => {
    vi.mocked(openaiProvider.transcribeAudio).mockResolvedValue([
      { start: 0, text: 'Hello' },
      { start: 31, text: 'World' },
    ]);
    const blob = new Blob([new Uint8Array(10)]);

    const { blocks } = await audioAdapter.parse(fakeSupabase(blob), {
      sourceId: 's1',
      storagePath: 'nb/s1/original.mp3',
      originUrl: null,
    });

    expect(blocks).toEqual([
      { text: 'Hello', startSeconds: 0 },
      { text: 'World', startSeconds: 31 },
    ]);
  });

  it('throws a non-retriable error when the file exceeds the size cap', async () => {
    const oversized = new Blob([new Uint8Array(26 * 1024 * 1024)]);
    await expect(
      audioAdapter.parse(fakeSupabase(oversized), {
        sourceId: 's1',
        storagePath: 'nb/s1/original.mp3',
        originUrl: null,
      }),
    ).rejects.toThrow(NonRetriableError);
  });
});
