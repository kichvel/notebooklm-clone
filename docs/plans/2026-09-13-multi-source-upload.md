# Multi-type Source Upload + Auto-generated Titles — Implementation Plan

**Goal:** Support PDF, DOCX, website, and YouTube sources (not just pasted text) with every source's title generated automatically from its content, matching NotebookLM's add-source dialog pattern.
**Branch:** `worktree-multi-source-upload`
**Stack:** Next.js App Router (route handlers), Supabase (Postgres/pgvector + Storage), Inngest, OpenAI provider (`src/lib/providers`), Vitest

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/<timestamp>_youtube_and_timestamps.sql` | Add `'youtube'` to `sources.type`, add `start_seconds` to `source_chunks` |
| Create | `src/lib/ingestion/adapters/types.ts` | `SourceBlock` / `SourceAdapter` interfaces |
| Create | `src/lib/ingestion/adapters/pastedText.ts` | Adapter wrapping today's plain-text read |
| Create | `src/lib/ingestion/adapters/pdf.ts` | PDF adapter (page-level blocks) via `unpdf` |
| Create | `src/lib/ingestion/adapters/docx.ts` | DOCX adapter (heading/section blocks) via `mammoth` |
| Create | `src/lib/ingestion/adapters/website.ts` | Website adapter (fetch + Readability extraction) |
| Create | `src/lib/ingestion/url-safety.ts` | SSRF guard: scheme/host/redirect/size/timeout checks |
| Create | `src/lib/ingestion/adapters/youtube.ts` | YouTube adapter (video-id parsing + transcript → timestamped blocks) |
| Create | `src/lib/ingestion/adapters/index.ts` | Adapter registry keyed by `source.type` |
| Modify | `src/lib/ingestion/index.ts` | Dispatch parse to adapters; carry block metadata through chunk/embed; add title-generation step |
| Modify | `src/lib/ingestion/ingestSource.test.ts` | Cover adapter dispatch + generated title |
| Modify | `src/lib/sources/index.ts` | Add `createFileSource`, `createWebsiteSource`, `createYoutubeSource`; make `createPastedTextSource` title optional |
| Test | `src/lib/sources/createFileSource.integration.test.ts` | New |
| Test | `src/lib/sources/createWebsiteSource.integration.test.ts` | New |
| Test | `src/lib/sources/createYoutubeSource.integration.test.ts` | New |
| Modify | `src/app/api/notebooks/[notebookId]/sources/route.ts` | Multipart file-upload branch; pasted-text title now optional |
| Create | `src/app/api/notebooks/[notebookId]/sources/website/route.ts` | `POST {url}` |
| Create | `src/app/api/notebooks/[notebookId]/sources/youtube/route.ts` | `POST {url}` |
| Modify | `src/components/sources/add-source-dialog.tsx` | Rebuild as drop zone + pill selector, no title field |
| Modify | `src/app/notebooks/[notebookId]/notebook-workspace.tsx` | `handleAddSource` branches by submission kind |
| Test | `src/components/sources/add-source-dialog.test.tsx` | New |
| Modify | `package.json` / `package-lock.json` | Add `unpdf`, `mammoth`, `@mozilla/readability`, `linkedom`, a YouTube transcript-fetch package |

---

## Tasks

### Task 1: Adapter interface, migration, and title generation (foundational pipeline refactor)

**Files:** `supabase/migrations/<timestamp>_youtube_and_timestamps.sql`, `src/lib/ingestion/adapters/types.ts`, `src/lib/ingestion/adapters/pastedText.ts`, `src/lib/ingestion/adapters/index.ts`, `src/lib/ingestion/index.ts`, `src/lib/ingestion/ingestSource.test.ts`

This task keeps pasted-text behavior working end-to-end through the new adapter-shaped pipeline, and adds title generation — everything downstream (PDF/DOCX/website/YouTube) plugs into this shape without touching `ingestSource` again.

- [ ] Write the migration:
  ```sql
  alter table public.sources
    drop constraint sources_type_check,
    add constraint sources_type_check check (type in ('pdf', 'docx', 'txt', 'pasted_text', 'website', 'youtube'));

  alter table public.source_chunks
    add column start_seconds numeric;
  ```
  Run `npx supabase migration new youtube_and_timestamps`, paste this in, then verify column names against the existing migration before applying.

- [ ] Define the adapter contract:
  ```ts
  // src/lib/ingestion/adapters/types.ts
  export interface SourceBlock {
    text: string;
    page?: number;
    section?: string;
    startSeconds?: number;
  }

  export interface ParseContext {
    sourceId: string;
    storagePath: string | null;
    originUrl: string | null;
  }

  export interface SourceAdapter {
    parse(supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>, context: ParseContext): Promise<{ blocks: SourceBlock[] }>;
  }
  ```

- [ ] Implement the pasted-text adapter, preserving today's behavior exactly:
  ```ts
  // src/lib/ingestion/adapters/pastedText.ts
  export const pastedTextAdapter: SourceAdapter = {
    async parse(supabase, { storagePath }) {
      if (!storagePath) throw new Error('Missing storage_path');
      const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
      if (error || !blob) throw error ?? new Error('Missing storage object');
      const text = await blob.text();
      return { blocks: [{ text }] };
    },
  };
  ```

- [ ] Add the registry (only `pasted_text` wired for now; later tasks add the rest):
  ```ts
  // src/lib/ingestion/adapters/index.ts
  import { pastedTextAdapter } from './pastedText';
  import type { SourceAdapter } from './types';

  export const adapters: Record<string, SourceAdapter> = {
    pasted_text: pastedTextAdapter,
  };

  export function getAdapter(type: string): SourceAdapter {
    const adapter = adapters[type];
    if (!adapter) throw new Error(`No ingestion adapter for source type "${type}"`);
    return adapter;
  }
  ```

- [ ] Refactor `ingestSource`'s parse step to dispatch through the adapter, and thread block metadata through normalize/chunk/embed:
  ```ts
  const blocks = await step.run('parse', async () => {
    await upsertProcessingStep(supabase, sourceId, 'parse', 'in_progress');
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .select('type, storage_path, origin_url')
      .eq('id', sourceId)
      .single();
    if (sourceError || !source) {
      await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
      throw new NonRetriableError(`Source ${sourceId} not found`);
    }
    await supabase.from('sources').update({ status: 'processing' }).eq('id', sourceId);
    try {
      const { blocks } = await getAdapter(source.type).parse(supabase, {
        sourceId,
        storagePath: source.storage_path,
        originUrl: source.origin_url,
      });
      await upsertProcessingStep(supabase, sourceId, 'parse', 'succeeded');
      return blocks;
    } catch (err) {
      await upsertProcessingStep(supabase, sourceId, 'parse', 'failed');
      throw err;
    }
  });
  ```
  Normalize each block's `text` (same whitespace cleanup as today, applied per block instead of once). Chunk *within* each block (never merging across blocks, so PDF page boundaries and DOCX sections are never crossed per ARCHITECTURE §6) and carry `page`/`section`/`startSeconds` onto each resulting chunk object. In the embed step's upsert, add `page_number: chunk.page ?? null, section: chunk.section ?? null, start_seconds: chunk.startSeconds ?? null`.

- [ ] Add a title-generation step before finalize:
  ```ts
  await step.run('generate-title', async () => {
    const sample = chunks.slice(0, 5).map((c) => c.text).join('\n\n').slice(0, 4000);
    const title = await generate({
      system: 'You write short, descriptive titles (5-10 words, no quotes, no trailing period) for documents added to a research notebook. Respond with only the title.',
      prompt: sample,
    });
    if (title.trim()) {
      await supabase.from('sources').update({ title: title.trim() }).eq('id', sourceId);
    }
  });
  ```
  Import `generate` alongside the existing `embed` import from `@/lib/providers/openai`. If `generate` throws or returns empty, leave the placeholder title in place rather than failing the whole source — title quality is not a correctness gate ingestion should fail on.

- [ ] Update `ingestSource.test.ts`'s existing integration test (gated by `hasRealEnv`, so it stays skipped in CI) to assert the final title is no longer the placeholder inserted at creation time (e.g. `expect(finalSource!.title).not.toBe('Ingestion test source')`), confirming the new step ran.

- [ ] Run `npm run test` — confirm it still passes (integration test stays skipped without real env; no new unit test yet since adapter dispatch has only one branch).
- [ ] Commit: `git commit -m "feat: adapter-based ingestion pipeline with title generation"`

### Task 2: PDF and DOCX adapters

**Files:** `src/lib/ingestion/adapters/pdf.ts`, `src/lib/ingestion/adapters/docx.ts`, `src/lib/ingestion/adapters/index.ts`, `src/lib/ingestion/adapters/pdf.test.ts`, `src/lib/ingestion/adapters/docx.test.ts`, `package.json`

- [ ] `npm install unpdf mammoth`
- [ ] Write the failing unit test for the PDF adapter using a tiny fixture PDF (generate one at test time or check in a small fixture under `src/lib/ingestion/adapters/__fixtures__/two-page.pdf`):
  ```ts
  it('produces one block per page', async () => {
    const buffer = await readFixture('two-page.pdf');
    const { blocks } = await pdfAdapter.parse(fakeSupabaseReturning(buffer), context);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].page).toBe(1);
    expect(blocks[1].page).toBe(2);
  });
  ```
- [ ] Run it — confirm it fails (no `pdf.ts` yet).
- [ ] Implement:
  ```ts
  // src/lib/ingestion/adapters/pdf.ts
  import { extractText, getDocumentProxy } from 'unpdf';

  export const pdfAdapter: SourceAdapter = {
    async parse(supabase, { storagePath }) {
      if (!storagePath) throw new Error('Missing storage_path');
      const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
      if (error || !blob) throw error ?? new Error('Missing storage object');
      const buffer = new Uint8Array(await blob.arrayBuffer());
      const doc = await getDocumentProxy(buffer);
      const { text } = await extractText(doc, { mergePages: false });
      const pages = Array.isArray(text) ? text : [text];
      const blocks = pages
        .map((pageText, i) => ({ text: pageText.trim(), page: i + 1 }))
        .filter((b) => b.text.length > 0);
      if (blocks.length === 0) throw new NonRetriableError('PDF has no extractable text (encrypted or image-only)');
      return { blocks };
    },
  };
  ```
- [ ] Same test-first flow for DOCX using `mammoth.extractRawText` (or `convertToHtml` if heading detection needs tag inspection) to derive `section` from the nearest preceding heading:
  ```ts
  // src/lib/ingestion/adapters/docx.ts
  import mammoth from 'mammoth';

  export const docxAdapter: SourceAdapter = {
    async parse(supabase, { storagePath }) {
      if (!storagePath) throw new Error('Missing storage_path');
      const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
      if (error || !blob) throw error ?? new Error('Missing storage object');
      const buffer = Buffer.from(await blob.arrayBuffer());
      const { value: html } = await mammoth.convertToHtml({ buffer });
      const blocks = splitHtmlIntoSectionBlocks(html); // helper: walk headings/paragraphs, track current heading as `section`
      if (blocks.length === 0) throw new NonRetriableError('DOCX has no extractable text');
      return { blocks };
    },
  };
  ```
  Write `splitHtmlIntoSectionBlocks` as a small local helper (regex or `linkedom` DOM walk — reuse `linkedom` here too rather than adding another HTML parser, pulling that dependency forward from Task 3).
- [ ] Register both in `src/lib/ingestion/adapters/index.ts`: `pdf: pdfAdapter, docx: docxAdapter`.
- [ ] Run tests — confirm passing.
- [ ] Commit: `git commit -m "feat: PDF and DOCX ingestion adapters"`

### Task 3: Website adapter with fetch safety

**Files:** `src/lib/ingestion/url-safety.ts`, `src/lib/ingestion/url-safety.test.ts`, `src/lib/ingestion/adapters/website.ts`, `src/lib/ingestion/adapters/website.test.ts`, `src/lib/ingestion/adapters/index.ts`, `package.json`

- [ ] `npm install linkedom @mozilla/readability`
- [ ] Write failing tests for the safety guard per ARCHITECTURE §11:
  ```ts
  it('rejects non-http(s) schemes', async () => {
    await expect(safeFetchHtml('ftp://example.com')).rejects.toThrow(/unsupported/i);
  });
  it('rejects private/loopback destinations', async () => {
    await expect(safeFetchHtml('http://127.0.0.1/secret')).rejects.toThrow(/unsupported/i);
    await expect(safeFetchHtml('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/unsupported/i);
  });
  it('enforces a response size limit', async () => {
    // mock fetch to stream more than MAX_BYTES
    await expect(safeFetchHtml('http://example.com/huge')).rejects.toThrow(/too large/i);
  });
  ```
- [ ] Implement `url-safety.ts`: validate scheme is `http:`/`https:`; resolve the hostname via `dns.lookup` (all addresses) and reject if any resolved address is private/loopback/link-local (`node:net`'s `isIP` plus manual CIDR checks, or the `ipaddr.js` package if a dependency is preferred — decide during implementation); fetch with an `AbortController` timeout; on redirect, re-resolve and re-validate the destination before following (cap at e.g. 3 hops); cap streamed response bytes, aborting once exceeded.
- [ ] Write the website adapter test with a small HTML fixture string run through `linkedom` + `Readability`, asserting extracted title/text and that boilerplate (nav/footer) is stripped.
- [ ] Implement:
  ```ts
  // src/lib/ingestion/adapters/website.ts
  import { parseHTML } from 'linkedom';
  import { Readability } from '@mozilla/readability';
  import { safeFetchHtml } from '../url-safety';

  export const websiteAdapter: SourceAdapter = {
    async parse(_supabase, { originUrl }) {
      if (!originUrl) throw new Error('Missing origin_url');
      const html = await safeFetchHtml(originUrl);
      const { document } = parseHTML(html);
      const article = new Readability(document as unknown as Document).parse();
      if (!article?.textContent?.trim()) {
        throw new NonRetriableError('Could not extract readable content (JS-rendered or login-required page)');
      }
      return { blocks: [{ text: article.textContent.trim(), section: article.title ?? undefined }] };
    },
  };
  ```
- [ ] Register `website: websiteAdapter` in the registry.
- [ ] Run tests — confirm passing.
- [ ] Commit: `git commit -m "feat: website ingestion adapter with SSRF-safe fetching"`

### Task 4: YouTube adapter with timestamped chunks

**Files:** `src/lib/ingestion/adapters/youtube.ts`, `src/lib/ingestion/adapters/youtube.test.ts`, `src/lib/ingestion/adapters/index.ts`, `package.json`

- [ ] `npm install <chosen transcript-fetch package>` — evaluate a lightweight, no-headless-browser option (e.g. one that hits the public timedtext endpoint) at implementation time; note the chosen package and its fetch mechanism in the commit message since this is the most fragile external dependency in the plan (relies on undocumented YouTube behavior).
- [ ] Write failing tests for video-ID extraction covering `youtube.com/watch?v=ID`, `youtu.be/ID`, and URLs with extra query params:
  ```ts
  it.each([
    ['https://www.youtube.com/watch?v=abc123XYZ_-', 'abc123XYZ_-'],
    ['https://youtu.be/abc123XYZ_-?t=30', 'abc123XYZ_-'],
    ['https://www.youtube.com/watch?v=abc123XYZ_-&list=PL1', 'abc123XYZ_-'],
  ])('extracts video id from %s', (url, expected) => {
    expect(extractVideoId(url)).toBe(expected);
  });
  ```
- [ ] Write a failing test for grouping raw caption cues into blocks with `startSeconds` (e.g. group every ~30 seconds of cues into one block) and for the missing-captions error path (mock the fetch to return no track).
- [ ] Implement `extractVideoId`, the transcript fetch, and grouping logic; throw `NonRetriableError('This video has no available transcript')` when no caption track exists.
- [ ] Register `youtube: youtubeAdapter` in the registry — this is the type added to the DB check constraint in Task 1.
- [ ] Run tests — confirm passing.
- [ ] Commit: `git commit -m "feat: YouTube transcript ingestion adapter with timestamped chunks"`

### Task 5: Source-creation functions and API routes

**Files:** `src/lib/sources/index.ts`, `src/lib/sources/createFileSource.integration.test.ts`, `src/lib/sources/createWebsiteSource.integration.test.ts`, `src/lib/sources/createYoutubeSource.integration.test.ts`, `src/app/api/notebooks/[notebookId]/sources/route.ts`, `src/app/api/notebooks/[notebookId]/sources/website/route.ts`, `src/app/api/notebooks/[notebookId]/sources/youtube/route.ts`

- [ ] Make `createPastedTextSource`'s `title` optional, defaulting to a placeholder:
  ```ts
  export interface CreatePastedTextSourceParams {
    notebookId: string;
    title?: string;
    text: string;
  }
  // ...
  .insert({ notebook_id: notebookId, type: 'pasted_text', title: title?.trim() || 'Pasted text' })
  ```
- [ ] Add `createFileSource`, deriving type from extension and a filename-based placeholder title:
  ```ts
  export interface CreateFileSourceParams {
    notebookId: string;
    filename: string;
    contentType: string;
    file: Blob;
  }

  const EXTENSION_TYPE: Record<string, 'pdf' | 'docx'> = { pdf: 'pdf', docx: 'docx' };

  export async function createFileSource(
    supabase: SupabaseClient,
    { notebookId, filename, file }: CreateFileSourceParams,
  ) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const type = EXTENSION_TYPE[ext];
    if (!type) throw new Error(`Unsupported file type: .${ext}`);
    const placeholderTitle = filename.replace(/\.[^.]+$/, '');
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert({ notebook_id: notebookId, type, title: placeholderTitle })
      .select()
      .single();
    if (sourceError) throw sourceError;

    const storagePath = `${notebookId}/${source.id}/original.${ext}`;
    const { error: uploadError } = await supabase.storage.from('sources').upload(storagePath, file);
    if (uploadError) throw uploadError;

    const { data: updated, error: updateError } = await supabase
      .from('sources')
      .update({ storage_path: storagePath })
      .eq('id', source.id)
      .select()
      .single();
    if (updateError) throw updateError;

    return enqueueOrMarkFailed(supabase, updated);
  }
  ```
  Factor the existing try/catch enqueue-or-mark-failed block out of `createPastedTextSource` into a shared `enqueueOrMarkFailed(supabase, source)` helper, and reuse it from `createFileSource`, `createWebsiteSource`, and `createYoutubeSource` — do not re-duplicate the try/catch four times.
- [ ] Add `createWebsiteSource({notebookId, url})` and `createYoutubeSource({notebookId, url})`, validating URL shape at the API boundary (reject non-http(s) or non-YouTube-host input immediately with a 400, before ever touching Storage/Inngest), inserting `origin_url` and a placeholder title (URL hostname for website, `'YouTube video'` for YouTube), then calling `enqueueOrMarkFailed`.
- [ ] In `sources/route.ts`, branch `POST` on content-type: if `multipart/form-data`, read `request.formData()`, `getAll('files')`, enforce 10MB/file and the remaining-slots-under-10 cap (query current non-deleted source count first; accept files up to the remaining slots, report the rest as `skipped` in the JSON response), call `createFileSource` per accepted file. Keep the existing JSON branch for pasted text, dropping the `title` requirement from validation.
- [ ] Add `website/route.ts` and `youtube/route.ts`, each a thin `POST` validating `{url}` is a non-empty string and delegating to the matching `create*Source` function (matching the auth/ownership check pattern already in `sources/route.ts`).
- [ ] Write integration tests mirroring `createPastedTextSource.integration.test.ts`'s `hasRealEnv`-gated pattern for each new creation function, asserting the row/storage/Inngest-enqueue shape.
- [ ] Run `npm run test` — confirm passing (new integration tests skip without real env, matching existing convention).
- [ ] Commit: `git commit -m "feat: file upload, website, and YouTube source-creation APIs"`

### Task 6: Add-source dialog rebuild

**Files:** `src/components/sources/add-source-dialog.tsx`, `src/components/sources/add-source-dialog.test.tsx`, `src/app/notebooks/[notebookId]/notebook-workspace.tsx`

- [ ] Write failing component tests for the pill selector:
  ```tsx
  it('shows a file drop zone by default and no title field', () => {
    render(<AddSourceDialog onAddFiles={vi.fn()} onAddWebsite={vi.fn()} onAddYoutube={vi.fn()} onAddText={vi.fn()} />);
    fireEvent.click(screen.getByText('Add sources'));
    expect(screen.getByText(/drop your files/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/title/i)).not.toBeInTheDocument();
  });

  it('switches to the website form when the Website pill is clicked', () => {
    // ...click 'Website' pill, expect a single URL input, no title field
  });
  ```
- [ ] Run — confirm failing (component doesn't exist in this shape yet).
- [ ] Rebuild `AddSourceDialog` with four modes (`files | website | youtube | text`) rendered as pills above a mode-specific form area; `files` mode is a drop zone (drag-and-drop + `<input type="file" multiple accept=".pdf,.docx">`) collecting a `FileList`; `website`/`youtube` modes are a single URL `Input`; `text` mode keeps the existing `Textarea` with no title field. Prop shape: `onAddFiles(files: FileList)`, `onAddWebsite(url: string)`, `onAddYoutube(url: string)`, `onAddText(text: string)`.
- [ ] Update `notebook-workspace.tsx`'s add-source wiring to branch by mode: files → build a `FormData` with `files.append('files', f)` per file and `POST` multipart to `/sources`; website/youtube → JSON `POST` to their respective new routes; text → JSON `POST` to `/sources` with just `{ text }`. Surface any `skipped` files (over the 10-source cap) from the response in the existing error-message slot.
- [ ] Run tests — confirm passing.
- [ ] Manually verify in the dev server: add a small PDF, a DOCX, a public URL, and a YouTube link to a notebook; confirm each appears with a placeholder title that updates to a generated title once `status` reaches `ready`, and that a YouTube source's citations (once asked about) carry a timestamped link.
- [ ] Commit: `git commit -m "feat: NotebookLM-style multi-type add-source dialog"`

---

## Self-review

1. **Task count:** 6 — within the ≤7 guideline.
2. **Coverage:** migration ✓ (Task 1), adapter interface ✓ (Task 1), PDF/DOCX ✓ (Task 2), website + ARCHITECTURE §11 safety ✓ (Task 3), YouTube + timestamped citations ✓ (Task 4), title generation for all types ✓ (Task 1's step runs for every type since it's in the shared pipeline), no-manual-title UI everywhere ✓ (Task 5 drops the requirement server-side, Task 6 removes it client-side), batch file upload with 10-source-cap handling ✓ (Task 5), out-of-scope items (notebook title, Drive/Play Books, OCR, in-app video playback, multi-URL batching) are simply not built anywhere in this plan.
3. **Placeholders:** none left — the one open technical choice (exact YouTube transcript-fetch package) is called out explicitly in Task 4 as a decision to make and document at implementation time, not a vague TBD.
4. **Type consistency:** `SourceBlock`/`SourceAdapter` (Task 1) are the single shape every adapter in Tasks 2-4 implements and the shape `ingestSource` consumes; `enqueueOrMarkFailed` (Task 5) is the one shared helper all four creation functions use, avoiding four divergent copies of the try/catch.
