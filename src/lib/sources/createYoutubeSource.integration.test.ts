// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { createYoutubeSource } from './index';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('createYoutubeSource', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    const service = createServiceClient();
    if (createdNotebookIds.length > 0) {
      await service.from('notebooks').delete().in('id', createdNotebookIds);
    }
  });

  it('registers a youtube source with a placeholder title and the video URL as origin_url', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'YouTube source test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const source = await createYoutubeSource(user, {
      notebookId: notebook!.id,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });

    expect(source.type).toBe('youtube');
    expect(source.title).toBe('YouTube video');
    expect(source.origin_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(['uploaded', 'failed']).toContain(source.status);
  }, 30000);

  it('rejects a URL that is not a YouTube link', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'YouTube source rejection test notebook' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);

    await expect(
      createYoutubeSource(user, { notebookId: notebook!.id, url: 'https://vimeo.com/12345' }),
    ).rejects.toThrow(/not a youtube link/i);
  }, 30000);
});
