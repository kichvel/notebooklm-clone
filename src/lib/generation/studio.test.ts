// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateNextFlashcards, generateNextQuizQuestions } from './studio';
import type { SearchResult } from '@/lib/retrieval';

vi.mock('@/lib/providers/openai', () => ({
  embed: vi.fn().mockResolvedValue([0]),
  generateFlashcards: vi.fn(),
  generateQuizQuestions: vi.fn(),
}));
vi.mock('@/lib/retrieval', () => ({ search: vi.fn() }));

function makeSupabaseStub() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: 'source-1',
              title: 'Overview of Voyager 1',
              type: 'website',
              origin_url: null,
              intro_summary: null,
            },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function makeResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    chunkId: 'chunk-default',
    sourceId: 'source-1',
    content: 'default content',
    chunkIndex: 0,
    pageNumber: null,
    section: null,
    startSeconds: null,
    similarity: 0.9,
    ...overrides,
  };
}

describe('generateNextFlashcards', () => {
  it('moves on to the next passage when one has no testable content instead of reporting exhausted', async () => {
    const { search } = await import('@/lib/retrieval');
    const { generateFlashcards } = await import('@/lib/providers/openai');
    vi.mocked(search).mockResolvedValue([
      makeResult({ chunkId: 'nav-junk', chunkIndex: 24, content: 'Keep Exploring Discover More' }),
      makeResult({
        chunkId: 'real-fact',
        chunkIndex: 18,
        content: 'Voyager 1 entered interstellar space in 2012.',
      }),
    ]);
    vi.mocked(generateFlashcards)
      .mockResolvedValueOnce([]) // nav-junk: model correctly declines
      .mockResolvedValueOnce([{ front: 'When did Voyager 1 enter interstellar space?', back: '2012' }]);

    const result = await generateNextFlashcards(makeSupabaseStub(), {
      notebookId: 'nb-1',
      excludeChunkIds: [],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.items).toHaveLength(1);
    // The citation must point at the chunk that actually grounded the card, not the skipped one.
    expect(result.items[0].citation.chunkId).toBe('real-fact');
  });

  it('reports exhausted only once every candidate passage has been tried', async () => {
    const { search } = await import('@/lib/retrieval');
    const { generateFlashcards } = await import('@/lib/providers/openai');
    vi.mocked(search).mockResolvedValue([makeResult({ chunkId: 'nav-junk', content: 'Keep Exploring' })]);
    vi.mocked(generateFlashcards).mockResolvedValue([]);

    const result = await generateNextFlashcards(makeSupabaseStub(), {
      notebookId: 'nb-1',
      excludeChunkIds: [],
    });

    expect(result.status).toBe('exhausted');
  });
});

describe('generateNextQuizQuestions', () => {
  it('moves on to the next passage when one has no testable content instead of reporting exhausted', async () => {
    const { search } = await import('@/lib/retrieval');
    const { generateQuizQuestions } = await import('@/lib/providers/openai');
    vi.mocked(search).mockResolvedValue([
      makeResult({ chunkId: 'nav-junk', chunkIndex: 24, content: 'Keep Exploring Discover More' }),
      makeResult({
        chunkId: 'real-fact',
        chunkIndex: 18,
        content: 'Voyager 1 entered interstellar space in 2012.',
      }),
    ]);
    vi.mocked(generateQuizQuestions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          question: 'What did Voyager 1 become the first spacecraft to do?',
          options: ['Land on Mars', 'Enter interstellar space', 'Orbit Saturn', 'Photograph the Sun'],
          correctIndex: 1,
        },
      ]);

    const result = await generateNextQuizQuestions(makeSupabaseStub(), {
      notebookId: 'nb-1',
      excludeChunkIds: [],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].citation.chunkId).toBe('real-fact');
  });
});
