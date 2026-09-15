// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { createPrimaryTestClient } from '@/lib/supabase/test-helpers';
import { createFileSource } from './index';

const hasRealEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);

describe.skipIf(!hasRealEnv)('createFileSource', () => {
  const createdNotebookIds: string[] = [];
  const uploadedStoragePaths: string[] = [];

  afterAll(async () => {
    const service = createServiceClient();
    if (uploadedStoragePaths.length > 0) {
      await service.storage.from('sources').remove(uploadedStoragePaths);
    }
    if (createdNotebookIds.length > 0) {
      await service.from('notebooks').delete().in('id', createdNotebookIds);
    }
  });

  it('registers a file source with a filename-derived placeholder title and uploads it to storage', async () => {
    const user = await createPrimaryTestClient();

    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'File source test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const file = new Blob(['%PDF-1.4 minimal test content'], { type: 'application/pdf' });

    const source = await createFileSource(user, {
      notebookId: notebook!.id,
      filename: 'Quarterly Report.pdf',
      file,
    });

    expect(source.title).toBe('Quarterly Report');
    expect(source.original_filename).toBe('Quarterly Report.pdf');
    expect(source.type).toBe('pdf');
    expect(['uploaded', 'failed']).toContain(source.status);
    expect(source.storage_path).toBe(`${notebook!.id}/${source.id}/original.pdf`);
    uploadedStoragePaths.push(source.storage_path as string);
  }, 30000);

  it('rejects an unsupported file extension', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'File source rejection test notebook' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);

    const file = new Blob(['irrelevant']);
    await expect(
      createFileSource(user, { notebookId: notebook!.id, filename: 'notes.exe', file }),
    ).rejects.toThrow(/unsupported file type/i);
  }, 30000);

  it('registers an audio file source as type audio', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook, error: notebookError } = await user
      .from('notebooks')
      .insert({ title: 'Audio source test notebook' })
      .select()
      .single();
    expect(notebookError).toBeNull();
    createdNotebookIds.push(notebook!.id);

    const file = new Blob([new Uint8Array(10)], { type: 'audio/mpeg' });

    const source = await createFileSource(user, {
      notebookId: notebook!.id,
      filename: 'Interview.mp3',
      file,
    });

    expect(source.title).toBe('Interview');
    expect(source.original_filename).toBe('Interview.mp3');
    expect(source.type).toBe('audio');
    expect(['uploaded', 'failed']).toContain(source.status);
    expect(source.storage_path).toBe(`${notebook!.id}/${source.id}/original.mp3`);
    uploadedStoragePaths.push(source.storage_path as string);
  }, 30000);

  it('rejects an audio file that exceeds the 25MB cap', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user
      .from('notebooks')
      .insert({ title: 'Audio size cap test notebook' })
      .select()
      .single();
    createdNotebookIds.push(notebook!.id);

    const file = new Blob([new Uint8Array(26 * 1024 * 1024)], { type: 'audio/mpeg' });

    await expect(
      createFileSource(user, { notebookId: notebook!.id, filename: 'huge.mp3', file }),
    ).rejects.toThrow(/25MB/);
  }, 30000);
});
