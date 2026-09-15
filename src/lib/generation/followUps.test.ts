import { describe, expect, it, vi } from 'vitest';
import { generateFollowUps } from './followUps';

vi.mock('@/lib/providers/openai', () => ({ generateFollowUpQuestions: vi.fn() }));

describe('generateFollowUps', () => {
  it('returns the questions from the provider call', async () => {
    const { generateFollowUpQuestions } = await import('@/lib/providers/openai');
    vi.mocked(generateFollowUpQuestions).mockResolvedValue(['A?', 'B?', 'C?']);

    const result = await generateFollowUps({ question: 'Q', answer: 'A', passages: '[1] text' });

    expect(result).toEqual(['A?', 'B?', 'C?']);
  });

  it('returns an empty array when the provider call throws', async () => {
    const { generateFollowUpQuestions } = await import('@/lib/providers/openai');
    vi.mocked(generateFollowUpQuestions).mockRejectedValue(new Error('boom'));

    const result = await generateFollowUps({ answer: 'A', passages: '[1] text' });

    expect(result).toEqual([]);
  });

  it('omits the question line from the prompt when no question is given', async () => {
    const { generateFollowUpQuestions } = await import('@/lib/providers/openai');
    vi.mocked(generateFollowUpQuestions).mockResolvedValue(['A?', 'B?', 'C?']);

    await generateFollowUps({ answer: 'A', passages: '[1] text' });

    const call = vi.mocked(generateFollowUpQuestions).mock.calls[0][0];
    expect(call.prompt).not.toContain('Question:');
  });
});
