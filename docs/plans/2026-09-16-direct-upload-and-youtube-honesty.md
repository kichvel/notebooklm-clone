# Direct-to-storage uploads + honest YouTube failures — Implementation Plan

**Goal:** Large file sources (e.g. an 18MB/175-page PDF) upload successfully in production, and YouTube transcript failures are retried and reported honestly instead of permanently misreporting "no transcript."
**Branch:** `worktree-fix-pdf-upload-youtube-transcript`
**Stack:** Next.js App Router, Supabase (Postgres + Storage + Auth), Inngest, Vitest

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/sources/index.ts` | `createFileSource` registers an already-uploaded Storage object instead of uploading a Blob; owns size limits now |
| Modify | `src/lib/sources/createFileSource.integration.test.ts` | Update to new signature (upload via test client first, then register) |
| Modify | `src/app/api/notebooks/[notebookId]/sources/route.ts` | Replace multipart file handling with JSON file-registration handling |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | `handleAddFiles` uploads to Storage via browser client, then registers |
| Test | `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx` | Cover the new upload+register flow and mixed skip messaging |
| Modify | `src/lib/ingestion/adapters/youtube.ts` | Retriable error, honest failure message |
| Test | `src/lib/ingestion/adapters/youtube.test.ts` | Update expectations for new error type/message |

---

## Task 1: `createFileSource` registers an already-uploaded object

**Files:** `src/lib/sources/index.ts`, `src/lib/sources/createFileSource.integration.test.ts`

- [ ] Update the integration test first to reflect the new contract: the caller uploads to Storage, then `createFileSource` registers it.
  ```ts
  it('registers a file source with a filename-derived placeholder title and uploads it to storage', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user.from('notebooks').insert({ title: 'File source test notebook' }).select().single();
    createdNotebookIds.push(notebook!.id);

    const id = crypto.randomUUID();
    const storagePath = `${notebook!.id}/${id}/original.pdf`;
    const { error: uploadError } = await user.storage
      .from('sources')
      .upload(storagePath, new Blob(['%PDF-1.4 minimal test content'], { type: 'application/pdf' }));
    expect(uploadError).toBeNull();
    uploadedStoragePaths.push(storagePath);

    const source = await createFileSource(user, { notebookId: notebook!.id, id, filename: 'Quarterly Report.pdf' });

    expect(source.title).toBe('Quarterly Report');
    expect(source.original_filename).toBe('Quarterly Report.pdf');
    expect(source.type).toBe('pdf');
    expect(source.id).toBe(id);
    expect(source.storage_path).toBe(storagePath);
  }, 30000);
  ```
  Apply the same upload-first pattern to the "registers an audio file source" test. For "rejects an unsupported file extension" and "rejects an audio file that exceeds the 25MB cap", upload first (extension check and size check both happen after the existence check, so the object must exist for the test to reach that code path), then assert the throw, then assert the object was cleaned up:
  ```ts
  it('rejects an audio file that exceeds the 25MB cap', async () => {
    const user = await createPrimaryTestClient();
    const { data: notebook } = await user.from('notebooks').insert({ title: 'Audio size cap test notebook' }).select().single();
    createdNotebookIds.push(notebook!.id);

    const id = crypto.randomUUID();
    const storagePath = `${notebook!.id}/${id}/original.mp3`;
    await user.storage.from('sources').upload(storagePath, new Blob([new Uint8Array(26 * 1024 * 1024)], { type: 'audio/mpeg' }));

    await expect(
      createFileSource(user, { notebookId: notebook!.id, id, filename: 'huge.mp3' }),
    ).rejects.toThrow(/25MB/);

    const { data: stillThere } = await user.storage.from('sources').info(storagePath);
    expect(stillThere).toBeNull();
  }, 30000);
  ```
- [ ] Run `npx vitest run src/lib/sources/createFileSource.integration.test.ts` — confirm it fails (old implementation doesn't accept `id`/skip the upload).
- [ ] Implement the new `createFileSource` in `src/lib/sources/index.ts`:
  ```ts
  const MAX_FILE_BYTES = 50 * 1024 * 1024;

  export interface CreateFileSourceParams {
    notebookId: string;
    id: string;
    filename: string;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  export async function createFileSource(
    supabase: SupabaseClient,
    { notebookId, id, filename }: CreateFileSourceParams,
  ) {
    if (!UUID_RE.test(id)) throw new Error('Invalid source id');

    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const type = FILE_EXTENSION_TYPE[ext];
    if (!type) throw new Error(`Unsupported file type: .${ext}`);

    const storagePath = `${notebookId}/${id}/original.${ext}`;
    const { data: info, error: infoError } = await supabase.storage.from('sources').info(storagePath);
    if (infoError || !info) throw new Error('Uploaded file was not found in storage');

    const limit = type === 'audio' ? MAX_TRANSCRIPTION_AUDIO_BYTES : MAX_FILE_BYTES;
    if ((info.size ?? 0) > limit) {
      await supabase.storage.from('sources').remove([storagePath]);
      throw new Error(`File exceeds ${limit / (1024 * 1024)}MB limit`);
    }

    const placeholderTitle = filename.replace(/\.[^.]+$/, '') || filename;

    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert({
        id,
        notebook_id: notebookId,
        type,
        title: placeholderTitle,
        original_filename: filename,
        storage_path: storagePath,
      })
      .select()
      .single();
    if (sourceError) {
      await supabase.storage.from('sources').remove([storagePath]);
      throw sourceError;
    }

    return enqueueOrMarkFailed(supabase, source);
  }
  ```
  Remove the old `CreateFileSourceParams.file: Blob` field and the `supabase.storage.from('sources').upload(...)` + separate `update({ storage_path })` steps it replaces.
- [ ] Run `npx vitest run src/lib/sources/createFileSource.integration.test.ts` — confirm passing (requires real Supabase env vars locally; skipped otherwise, same as today).
- [ ] Run `npm run typecheck` — fix any callers still using the old `{ file: Blob }` shape (route.ts, handled in Task 2).
- [ ] Commit: `git commit -m "feat(sources): register already-uploaded files instead of uploading blobs server-side"`

## Task 2: API route accepts JSON file registration instead of multipart

**Files:** `src/app/api/notebooks/[notebookId]/sources/route.ts`

- [ ] Replace `handleFileUpload` with a JSON-based `handleFileRegistration`:
  ```ts
  async function handleFileRegistration(
    supabase: Awaited<ReturnType<typeof createClient>>,
    notebookId: string,
    files: { id: string; filename: string }[],
  ) {
    if (files.length === 0) {
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
    }

    const { count: existingCount } = await supabase
      .from('sources')
      .select('id', { count: 'exact', head: true })
      .eq('notebook_id', notebookId)
      .is('deleted_at', null);

    const remainingSlots = Math.max(0, MAX_SOURCES_PER_NOTEBOOK - (existingCount ?? 0));

    const created: unknown[] = [];
    const skipped: { filename: string; reason: string }[] = [];

    for (const file of files) {
      if (created.length >= remainingSlots) {
        skipped.push({ filename: file.filename, reason: 'Notebook source limit reached' });
        continue;
      }
      try {
        const source = await createFileSource(supabase, {
          notebookId,
          id: file.id,
          filename: file.filename,
        });
        created.push(source);
      } catch (err) {
        skipped.push({
          filename: file.filename,
          reason: err instanceof Error ? err.message : 'Unsupported or invalid file',
        });
      }
    }

    return NextResponse.json({ created, skipped }, { status: 201 });
  }
  ```
  Delete the old `handleFileUpload`, `MAX_FILE_BYTES`, `AUDIO_EXTENSIONS` constants and the `MAX_TRANSCRIPTION_AUDIO_BYTES` import (size limits now live in `sources/index.ts`).
- [ ] Update `POST` to dispatch on JSON shape instead of `content-type`:
  ```ts
  const body = await request.json();
  if (Array.isArray(body?.files)) {
    return handleFileRegistration(supabase, notebookId, body.files);
  }

  const { title, text } = body ?? {};
  if (typeof text !== 'string' || !text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  ```
  Remove the `contentType.includes('multipart/form-data')` branch and the now-unused `request` parameter from `handleFileRegistration`'s signature (it no longer reads `request.formData()`).
- [ ] Run `npm run typecheck` and `npm run lint` — fix any fallout.
- [ ] Commit: `git commit -m "feat(api): register files by id instead of accepting multipart uploads"`

## Task 3: Client uploads directly to Storage, then registers

**Files:** `src/app/notebooks/[notebookId]/notebook-workspace.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.test.tsx`

- [ ] Write the failing test first — mock the browser Supabase client and assert the flow: Storage upload happens, then a JSON registration POST, and a mixed-skip message merges client upload failures with server-reported skips.
  ```ts
  vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({
      storage: {
        from: () => ({ upload: uploadMock }),
      },
    }),
  }));
  ```
  ```ts
  it('uploads files directly to storage before registering them, and merges upload failures with server-reported skips', async () => {
    uploadMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'network error' } });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/sources')) {
        return jsonResponse({ created: [{ id: 's1' }], skipped: [{ filename: 'b.pdf', reason: 'File exceeds 50MB limit' }] });
      }
      if (url.endsWith('/sources')) return jsonResponse([]);
      if (url.endsWith('/messages')) return jsonResponse([]);
      return jsonResponse({ id: 'n1', title: 'Untitled notebook' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotebookWorkspace notebookId="n1" />);
    // drive handleAddFiles via the Add sources dialog's file input, selecting two files named a.pdf and c.pdf

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall![1]!.body as string).files).toEqual([{ id: expect.any(String), filename: 'a.pdf' }]);
    });
    expect(await screen.findByText(/c\.pdf \(upload failed\)/i)).toBeInTheDocument();
    expect(await screen.findByText(/b\.pdf \(file exceeds 50mb limit\)/i)).toBeInTheDocument();
  });
  ```
- [ ] Run it — confirm it fails.
- [ ] Implement in `notebook-workspace.tsx`. Add the import:
  ```ts
  import { createClient } from '@/lib/supabase/client';
  ```
  Update `postSource` to accept optional pre-existing skips and merge them, and rewrite `handleAddFiles`:
  ```ts
  async function postSource(
    input: RequestInit,
    extraSkips: { filename: string; reason: string }[] = [],
  ) {
    setError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: 'POST',
        ...input,
      });
      if (!response.ok) throw new Error('Failed to add source');
      const body = await response.json();
      const skipped = [...extraSkips, ...(Array.isArray(body?.skipped) ? body.skipped : [])];
      if (skipped.length > 0) {
        setError(
          `Some files were skipped: ${skipped.map((s: { filename: string; reason: string }) => `${s.filename} (${s.reason})`).join(', ')}`,
        );
      }
      await refreshSources();
    } catch (err) {
      setError('Something went wrong adding that source. Please try again.');
      throw err;
    }
  }

  async function handleAddFiles(files: FileList) {
    const supabase = createClient();
    const registrations: { id: string; filename: string }[] = [];
    const uploadSkips: { filename: string; reason: string }[] = [];

    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const { error } = await supabase.storage
        .from('sources')
        .upload(`${notebookId}/${id}/original.${ext}`, file);
      if (error) {
        uploadSkips.push({ filename: file.name, reason: 'Upload failed' });
      } else {
        registrations.push({ id, filename: file.name });
      }
    }

    if (registrations.length === 0) {
      setError(`Some files were skipped: ${uploadSkips.map((s) => `${s.filename} (${s.reason})`).join(', ')}`);
      return;
    }

    await postSource(
      { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: registrations }) },
      uploadSkips,
    );
  }
  ```
- [ ] Run `npx vitest run src/app/notebooks/\[notebookId\]/notebook-workspace.test.tsx` — confirm passing.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] Commit: `git commit -m "feat(workspace): upload files to storage directly, bypassing the serverless body-size limit"`

## Task 4: YouTube transcript failures are retriable and honest

**Files:** `src/lib/ingestion/adapters/youtube.ts`, `src/lib/ingestion/adapters/youtube.test.ts`

- [ ] Update the two failing-path tests to expect a plain retriable `Error` with the new message instead of `NonRetriableError`:
  ```ts
  it('throws a retriable error when captions cannot be fetched', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );

    const call = youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    await expect(call).rejects.not.toThrow(NonRetriableError);
    await expect(call).rejects.toThrow(/couldn't retrieve a transcript/i);
  });

  it('throws a retriable error when the transcript resolves with zero cues', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValue([]);

    const call = youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    await expect(call).rejects.not.toThrow(NonRetriableError);
    await expect(call).rejects.toThrow(/couldn't retrieve a transcript/i);
  });
  ```
  (Note: `expect().rejects.not.toThrow(NonRetriableError)` only confirms it's not that subclass — pair it with checking the error is a plain `Error` via `await expect(call).rejects.toBeInstanceOf(Error)` if the test runner's `not.toThrow(SpecificClass)` semantics need it; verify during implementation and adjust the assertion to whatever cleanly expresses "rejects, and is not a NonRetriableError.")
- [ ] Run `npx vitest run src/lib/ingestion/adapters/youtube.test.ts` — confirm the two updated tests fail against current code.
- [ ] Implement in `youtube.ts`: drop the `NonRetriableError` import if now unused elsewhere in the file (check `extractVideoId`'s "Could not extract a video ID" throw — that one stays non-retriable since a malformed URL will never succeed on retry), and change the caption-failure branch:
  ```ts
  export const youtubeAdapter: SourceAdapter = {
    async parse(_supabase, { originUrl }) {
      if (!originUrl) throw new Error('Missing origin_url');
      const videoId = extractVideoId(originUrl);
      if (!videoId) throw new NonRetriableError(`Could not extract a video ID from ${originUrl}`);

      let cues: TranscriptResponse[];
      try {
        cues = await fetchEnglishTranscript(videoId);
      } catch (err) {
        if (
          err instanceof YoutubeTranscriptDisabledError ||
          err instanceof YoutubeTranscriptNotAvailableError
        ) {
          throw new Error(
            "Couldn't retrieve a transcript for this video. It may not have captions, or automated access may be temporarily blocked.",
          );
        }
        throw err;
      }

      const blocks = groupTimedItemsIntoBlocks(cues.map((c) => ({ start: c.offset, text: c.text })));
      if (blocks.length === 0) {
        throw new Error(
          "Couldn't retrieve a transcript for this video. It may not have captions, or automated access may be temporarily blocked.",
        );
      }

      return { blocks };
    },
  };
  ```
- [ ] Run `npx vitest run src/lib/ingestion/adapters/youtube.test.ts` — confirm passing.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] Commit: `git commit -m "fix(ingestion): retry youtube transcript fetch failures instead of permanently misreporting no transcript"`

## Task 5: Docs check

**Files:** `docs/ARCHITECTURE.md`

- [ ] Search `docs/ARCHITECTURE.md` for a description of the file upload path (multipart through the API route). If present, update it to describe direct-to-Storage upload followed by JSON registration. If the doc doesn't go into this level of detail, skip this task with no changes.
- [ ] If changed, commit: `git commit -m "docs: describe direct-to-storage upload flow"`

---

## Self-review

- **Task count:** 5 — within the ≤7 guideline.
- **Coverage:** size limits (Task 1), route contract (Task 2), client upload flow + merged error messaging (Task 3), YouTube honesty/retriability (Task 4), docs (Task 5). Orphan-cleanup-on-registration-failure is covered inside Task 1 (delete on size/insert failure). Cross-file-crash orphan sweep is explicitly out of scope per the design brief — no task needed.
- **Placeholders:** none left as TBD; the one caveat noted in Task 4 about the exact Vitest assertion form is a real implementation judgment call (verify the assertion actually distinguishes error type at edit time), not a deferred decision.
- **Type consistency:** `CreateFileSourceParams` (`{notebookId, id, filename}`) used identically in Task 1's implementation and Task 2's route call. The `{id, filename}` shape is used identically in Task 2's `files` array and Task 3's `registrations` array and test payload.
