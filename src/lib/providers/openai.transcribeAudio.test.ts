// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn(function () {
    return { audio: { transcriptions: { create: createMock } } };
  }),
  toFile: vi.fn(async (buffer: Buffer, filename: string) => ({ buffer, filename })),
}));

import { transcribeAudio } from './openai';

describe('transcribeAudio', () => {
  it('maps verbose_json segments to timed items', async () => {
    createMock.mockResolvedValue({
      segments: [
        { start: 0, end: 4, text: 'Hello there' },
        { start: 4, end: 8, text: 'General Kenobi' },
      ],
    });

    const result = await transcribeAudio(Buffer.from('fake-audio'), 'clip.mp3');

    expect(result).toEqual([
      { start: 0, text: 'Hello there' },
      { start: 4, text: 'General Kenobi' },
    ]);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      }),
    );
  });
});
