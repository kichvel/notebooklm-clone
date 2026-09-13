# Audio Sources (Direct Upload + YouTube Fallback) — Implementation Plan

**Goal:** Add a direct "Audio" source type and a speech-to-text fallback for caption-less YouTube videos, sharing one `transcribeAudio()` capability.
**Branch:** `audio-sources`
**Stack:** Next.js App Router, TypeScript, Supabase (Postgres/Storage), Inngest, OpenAI (`whisper-1`), `@distube/ytdl-core`

---

## Post-ship update (2026-09-13): YouTube audio-fallback reverted

The YouTube-audio-fallback half of this plan (Task 4) shipped, then broke in production twice in the same day, in two different unfixable ways:

1. `@distube/ytdl-core` (chosen in Task 4) turned out to already be archived by its maintainer (August 2025) and failed with `Failed to find any playable formats` — a known, recurring issue in that dead library.
2. Swapped to `youtubei.js` (actively maintained). It then failed with `No valid URL to decipher` — an actively-tracked, ongoing issue where YouTube's signature-cipher scheme outpaces the library's own extraction logic, affecting even its latest release.

Given two structurally different failures from two different libraries within the same day, the YouTube-audio-fallback path was reverted: `youtube.ts` is back to caption-only (fails clearly with "This video has no available transcript" when no caption track exists, whether `youtube-transcript` throws or resolves with zero cues). `@distube/ytdl-core` and `youtubei.js` were both removed as dependencies.

**Task 3 (direct Audio source type) is unaffected and remains shipped** — it never depended on either extraction library. A caption-less YouTube video's audio can still be added to a notebook by downloading it separately and uploading it as a direct Audio source. Sections below describe the plan as originally written/executed; treat Task 4 as historical/reverted.

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/providers/openai.ts` | Add `transcribeAudio()` (whisper-1, verbose_json, segment timestamps) |
| Create | `src/lib/ingestion/blockGrouping.ts` | Shared timed-segment → `SourceBlock[]` grouping (extracted from `youtube.ts`) |
| Test   | `src/lib/ingestion/blockGrouping.test.ts` | Grouping behavior |
| Modify | `src/lib/ingestion/adapters/youtube.ts` | Use shared grouping; add audio-fallback branch on caption failure |
| Modify | `src/lib/ingestion/adapters/youtube.test.ts` | Cover fallback path |
| Create | `src/lib/ingestion/adapters/audio.ts` | New adapter: download original from Storage, transcribe, group |
| Test   | `src/lib/ingestion/adapters/audio.test.ts` | Adapter behavior incl. size-cap rejection |
| Modify | `src/lib/ingestion/adapters/index.ts` | Register `'audio'` adapter |
| Modify | `supabase/migrations/` (new file) | Add `'audio'` to `sources.type` check constraint |
| Modify | `src/lib/sources/index.ts` | Extend `FILE_EXTENSION_TYPE`; audio size cap constant |
| Modify | `src/lib/sources/createFileSource.integration.test.ts` | Cover audio extension routing + size cap |
| Modify | `src/app/api/notebooks/[notebookId]/sources/route.ts` | Branch max file size by detected type (audio: 25MB, existing: 10MB) |
| Modify | `src/components/sources/add-source-dialog.tsx` | Accept audio extensions in file input + drop zone copy |
| Modify | `package.json` / `package-lock.json` | Add `@distube/ytdl-core` |
| Modify | `docs/ARCHITECTURE.md` | Update adapter list / source types (§6) if it enumerates them |

---

## Task 1: Shared timed-block grouping utility

**Files:** `src/lib/ingestion/blockGrouping.ts`, `src/lib/ingestion/blockGrouping.test.ts`, `src/lib/ingestion/adapters/youtube.ts`, `src/lib/ingestion/adapters/youtube.test.ts`

- [ ] Write the failing test for the extracted utility
  ```ts
  // src/lib/ingestion/blockGrouping.test.ts
  import { describe, expect, it } from 'vitest';
  import { groupTimedItemsIntoBlocks } from './blockGrouping';

  describe('groupTimedItemsIntoBlocks', () => {
    it('groups items into ~30 second blocks carrying startSeconds', () => {
      const items = [
        { start: 0, text: 'Hello' },
        { start: 5, text: 'world' },
        { start: 31, text: 'this is minute one' },
        { start: 40, text: 'continuing' },
      ];
      const blocks = groupTimedItemsIntoBlocks(items);
      expect(blocks).toEqual([
        { text: 'Hello world', startSeconds: 0 },
        { text: 'this is minute one continuing', startSeconds: 31 },
      ]);
    });

    it('returns an empty array for no items', () => {
      expect(groupTimedItemsIntoBlocks([])).toEqual([]);
    });
  });
  ```
- [ ] Run it — confirm it fails (module doesn't exist)
- [ ] Implement by extracting the existing `groupCuesIntoBlocks` body into the new file, generalized over `{ start: number; text: string }[]` instead of `TranscriptResponse[]`:
  ```ts
  // src/lib/ingestion/blockGrouping.ts
  import 'server-only';
  import type { SourceBlock } from './adapters/types';

  const BLOCK_DURATION_SECONDS = 30;

  export interface TimedItem {
    start: number;
    text: string;
  }

  export function groupTimedItemsIntoBlocks(items: TimedItem[]): SourceBlock[] {
    if (items.length === 0) return [];

    const blocks: SourceBlock[] = [];
    let blockStart = items[0].start;
    let blockTexts: string[] = [];

    for (const item of items) {
      if (item.start - blockStart >= BLOCK_DURATION_SECONDS && blockTexts.length > 0) {
        blocks.push({ text: blockTexts.join(' ').trim(), startSeconds: blockStart });
        blockStart = item.start;
        blockTexts = [];
      }
      blockTexts.push(item.text);
    }
    if (blockTexts.length > 0) {
      blocks.push({ text: blockTexts.join(' ').trim(), startSeconds: blockStart });
    }

    return blocks.filter((b) => b.text.length > 0);
  }
  ```
- [ ] Update `youtube.ts` to drop its local `groupCuesIntoBlocks`/`BLOCK_DURATION_SECONDS` and instead map cues then call the shared function:
  ```ts
  import { groupTimedItemsIntoBlocks } from '../blockGrouping';
  // ...
  const blocks = groupTimedItemsIntoBlocks(cues.map((c) => ({ start: c.offset, text: c.text })));
  ```
- [ ] Update `youtube.test.ts`: remove the `groupCuesIntoBlocks` describe block (now covered by `blockGrouping.test.ts`), keep `extractVideoId` and `youtubeAdapter` describes as-is
- [ ] Run tests — confirm passing
- [ ] Commit: `git commit -m "refactor: extract timed-block grouping into a shared ingestion utility"`

## Task 2: `transcribeAudio()` provider function

**Files:** `src/lib/providers/openai.ts`, `src/lib/providers/openai.transcribeAudio.test.ts`

- [ ] Write the failing test (mock the OpenAI client's `audio.transcriptions.create`)
  ```ts
  // src/lib/providers/openai.transcribeAudio.test.ts
  // @vitest-environment node
  import { describe, expect, it, vi } from 'vitest';

  const createMock = vi.fn();
  vi.mock('openai', () => ({
    default: vi.fn(() => ({ audio: { transcriptions: { create: createMock } } })),
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
  ```
- [ ] Run it — confirm it fails
- [ ] Implement in `src/lib/providers/openai.ts`:
  ```ts
  import OpenAI, { toFile } from 'openai';
  // ...
  const TRANSCRIPTION_MODEL = 'whisper-1';

  export interface TranscribedSegment {
    start: number;
    text: string;
  }

  export async function transcribeAudio(
    buffer: Buffer,
    filename: string,
  ): Promise<TranscribedSegment[]> {
    const response = await getClient().audio.transcriptions.create({
      file: await toFile(buffer, filename),
      model: TRANSCRIPTION_MODEL,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    const segments = (response as { segments?: { start: number; text: string }[] }).segments ?? [];
    return segments.map((s) => ({ start: s.start, text: s.text.trim() })).filter((s) => s.text);
  }
  ```
- [ ] Run tests — confirm passing
- [ ] Commit: `git commit -m "feat: add transcribeAudio() to the OpenAI provider"`

## Task 3: Direct Audio source type (migration, adapter, upload path, dialog UI)

**Files:** `supabase/migrations/<ts>_audio_source_type.sql`, `src/lib/ingestion/adapters/audio.ts`, `src/lib/ingestion/adapters/audio.test.ts`, `src/lib/ingestion/adapters/index.ts`, `src/lib/sources/index.ts`, `src/lib/sources/createFileSource.integration.test.ts`, `src/app/api/notebooks/[notebookId]/sources/route.ts`, `src/components/sources/add-source-dialog.tsx`

- [ ] Create migration:
  ```sql
  -- supabase/migrations/20260913180000_audio_source_type.sql
  alter table public.sources
    drop constraint sources_type_check,
    add constraint sources_type_check
      check (type in ('pdf', 'docx', 'txt', 'pasted_text', 'website', 'youtube', 'audio'));
  ```
- [ ] Write the failing adapter test
  ```ts
  // src/lib/ingestion/adapters/audio.test.ts
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
  ```
- [ ] Run it — confirm it fails
- [ ] Implement the adapter:
  ```ts
  // src/lib/ingestion/adapters/audio.ts
  import 'server-only';
  import { NonRetriableError } from 'inngest';
  import { transcribeAudio } from '@/lib/providers/openai';
  import { groupTimedItemsIntoBlocks } from '../blockGrouping';
  import type { SourceAdapter } from './types';

  export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

  export const audioAdapter: SourceAdapter = {
    async parse(supabase, { storagePath }) {
      if (!storagePath) throw new Error('Missing storage_path');
      const { data: blob, error } = await supabase.storage.from('sources').download(storagePath);
      if (error || !blob) throw error ?? new Error('Missing storage object');
      if (blob.size > MAX_AUDIO_BYTES) {
        throw new NonRetriableError('Audio file exceeds the 25MB transcription limit');
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const filename = storagePath.split('/').pop() ?? 'audio';
      const segments = await transcribeAudio(buffer, filename);
      const blocks = groupTimedItemsIntoBlocks(segments);

      if (blocks.length === 0) {
        throw new NonRetriableError('Could not transcribe any speech from this audio');
      }
      return { blocks };
    },
  };
  ```
- [ ] Register in `adapters/index.ts`: import `audioAdapter`, add `audio: audioAdapter` to the `adapters` record
- [ ] Extend `src/lib/sources/index.ts`:
  ```ts
  const FILE_EXTENSION_TYPE: Record<string, 'pdf' | 'docx' | 'audio'> = {
    pdf: 'pdf',
    docx: 'docx',
    mp3: 'audio',
    wav: 'audio',
    m4a: 'audio',
    webm: 'audio',
    ogg: 'audio',
  };

  export const MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024;
  ```
  and in `createFileSource`, after resolving `type`, validate size against the right cap:
  ```ts
  const maxBytes = type === 'audio' ? MAX_AUDIO_FILE_BYTES : undefined; // pdf/docx capped upstream in route.ts
  ```
  (Actual byte-size enforcement for pdf/docx already happens in `route.ts` before calling `createFileSource`; extend that same route-level check to branch by extension instead of one flat constant — see next step.)
- [ ] Update `src/app/api/notebooks/[notebookId]/sources/route.ts`:
  ```ts
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024;
  const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'webm', 'ogg']);

  // inside the per-file loop, replace the flat MAX_FILE_BYTES check with:
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const limit = AUDIO_EXTENSIONS.has(ext) ? MAX_AUDIO_FILE_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) {
    skipped.push({ filename: file.name, reason: `File exceeds ${limit / (1024 * 1024)}MB limit` });
    continue;
  }
  ```
- [ ] Update `createFileSource.integration.test.ts` to add a case uploading a small audio buffer with a `.mp3` name and asserting `type: 'audio'` on the created row, plus a case for the size cap
- [ ] Update `add-source-dialog.tsx`: extend the file input's `accept` attribute and drop-zone copy
  ```tsx
  accept=".pdf,.docx,.mp3,.wav,.m4a,.webm,.ogg"
  // ...
  <p className="text-xs">pdf, docx, audio</p>
  ```
- [ ] Run `npm run test` — confirm passing
- [ ] Commit: `git commit -m "feat: add direct audio source type via whisper-1 transcription"`

## Task 4: YouTube audio-fallback for caption-less videos

**Files:** `src/lib/ingestion/adapters/youtube.ts`, `src/lib/ingestion/adapters/youtube.test.ts`, `package.json`

- [ ] `npm install @distube/ytdl-core`
- [ ] Write the failing test for the fallback branch
  ```ts
  // added to youtube.test.ts
  vi.mock('@distube/ytdl-core', () => ({
    default: Object.assign(vi.fn(), { getInfo: vi.fn() }),
  }));
  vi.mock('@/lib/providers/openai', () => ({ transcribeAudio: vi.fn() }));

  it('falls back to audio transcription when captions are disabled', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );
    const ytdl = (await import('@distube/ytdl-core')).default;
    vi.mocked(ytdl.getInfo).mockResolvedValue({} as never);
    vi.mocked(ytdl).mockReturnValue(
      Readable.from([Buffer.from('a'.repeat(1000))]) as never,
    );
    const { transcribeAudio } = await import('@/lib/providers/openai');
    vi.mocked(transcribeAudio).mockResolvedValue([{ start: 0, text: 'Fallback speech' }]);

    const { blocks } = await youtubeAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
    });

    expect(blocks).toEqual([{ text: 'Fallback speech', startSeconds: 0 }]);
  });

  it('throws non-retriably when fallback audio exceeds the size cap', async () => {
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValue(
      new YoutubeTranscriptDisabledError('abc123XYZ_-'),
    );
    const ytdl = (await import('@distube/ytdl-core')).default;
    vi.mocked(ytdl.getInfo).mockResolvedValue({} as never);
    vi.mocked(ytdl).mockReturnValue(
      Readable.from([Buffer.alloc(26 * 1024 * 1024)]) as never,
    );

    await expect(
      youtubeAdapter.parse(undefined as never, {
        sourceId: 'source-1',
        storagePath: null,
        originUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-',
      }),
    ).rejects.toThrow(NonRetriableError);
  });
  ```
- [ ] Run it — confirm it fails
- [ ] Implement the fallback in `youtube.ts`:
  ```ts
  import ytdl from '@distube/ytdl-core';
  import { transcribeAudio } from '@/lib/providers/openai';

  const MAX_FALLBACK_AUDIO_BYTES = 25 * 1024 * 1024;

  async function downloadLowestBitrateAudio(videoId: string): Promise<Buffer> {
    const stream = ytdl(videoId, { filter: 'audioonly', quality: 'lowestaudio' });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > MAX_FALLBACK_AUDIO_BYTES) {
        stream.destroy();
        throw new NonRetriableError('Video audio exceeds the 25MB transcription limit');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // inside parse(), replacing the immediate throw on Disabled/NotAvailable:
  } catch (err) {
    if (
      err instanceof YoutubeTranscriptDisabledError ||
      err instanceof YoutubeTranscriptNotAvailableError
    ) {
      const audio = await downloadLowestBitrateAudio(videoId);
      const segments = await transcribeAudio(audio, `${videoId}.webm`);
      const blocks = groupTimedItemsIntoBlocks(segments);
      if (blocks.length === 0) {
        throw new NonRetriableError('Could not transcribe any speech from this video');
      }
      return { blocks };
    }
    throw err;
  }
  ```
- [ ] Run `npm run test` — confirm passing
- [ ] Commit: `git commit -m "feat: fall back to audio transcription for caption-less YouTube videos"`

## Task 5: Docs pass

**Files:** `docs/ARCHITECTURE.md` (only if it enumerates source types/adapters — check §6 and §11 before editing)

- [ ] Read the current §6 adapter list and §2 source-type mentions; if source types or adapters are enumerated there, add `audio` and the YouTube fallback behavior in one or two sentences, consistent with existing phrasing
- [ ] Run `npm run lint && npm run typecheck && npm run test && npm run build` as the final full-suite check
- [ ] Commit: `git commit -m "docs: note audio source type and YouTube transcription fallback"`

---

## Self-review

1. **Task count** — 5 tasks, within the ≤7 guideline.
2. **Coverage** — grouping refactor (T1), core transcription capability (T2), direct audio type end-to-end incl. migration/UI/API (T3), YouTube fallback reusing T2 (T4), docs (T5). All brief success criteria map to a task.
3. **Placeholders** — none; every step has concrete code.
4. **Type consistency** — `TimedItem { start, text }` used consistently by both `transcribeAudio()`'s return shape and `groupTimedItemsIntoBlocks`'s input; `SourceBlock` unchanged from the existing adapter interface (`text, page?, section?, startSeconds?`).

**Known risk to flag during execution:** `@distube/ytdl-core` can break when YouTube changes its player/signature scheme — if `ytdl.getInfo`/streaming fails in a way that isn't the caption-specific errors already handled, that should surface as a normal retriable error (not swallowed), so a transient break gets retried rather than silently producing an empty source.
