// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { rewriteFollowUpQuery } from './rewriteQuery';

vi.mock('@/lib/providers/openai', () => ({ generate: vi.fn() }));

describe('rewriteFollowUpQuery', () => {
  it('returns the question unchanged and does not call the model when there is no history', async () => {
    const { generate } = await import('@/lib/providers/openai');
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
      }),
    } as never;

    const result = await rewriteFollowUpQuery(supabase, {
      notebookId: 'n1',
      question: 'What is this about?',
    });

    expect(result).toBe('What is this about?');
    expect(generate).not.toHaveBeenCalled();
  });
});
