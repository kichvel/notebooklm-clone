// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { createWebsiteSource } from './index';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('createWebsiteSource', () => {
  const createdNotebookIds: string[] = [];

  afterAll(async () => {
    const service = createServiceClient();
    if (createdNotebookIds.length > 0) {
      await service.from('notebooks').delete().in('id', createdNotebookIds);
    }
  });

  it('registers a website source with a hostname-derived placeholder title and no storage upload', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'Website source test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const source = await createWebsiteSource(user, {
      notebookId: notebook!.id,
      url: 'https://example.com/article',
    });

    expect(source.type).toBe('website');
    expect(source.title).toBe('example.com');
    expect(source.origin_url).toBe('https://example.com/article');
    expect(['uploaded', 'failed']).toContain(source.status);
  }, 30000);

  it('rejects a non-http(s) URL scheme', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Website source rejection test notebook' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);

    await expect(
      createWebsiteSource(user, { notebookId: notebook!.id, url: 'ftp://example.com/file' }),
    ).rejects.toThrow(/unsupported url scheme/i);
  }, 30000);
});
