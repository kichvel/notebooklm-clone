# Design Brief — Audio Sources (Direct Upload + YouTube Fallback)

**Goal:** Let users add audio files as a source type, and make YouTube videos with no captions still ingestible, by transcribing audio with speech-to-text.

**Date:** 2026-09-13

## Shared understanding

Today's YouTube adapter only works when YouTube exposes a caption track (manual or auto-generated); videos with captions disabled fail outright. This pass adds a speech-to-text fallback so those videos still ingest, and — since the fallback needs a "transcribe raw audio into timestamped blocks" capability anyway — reuses that same capability to add a new direct **Audio** source type (mp3/wav/m4a/webm/ogg), merged into the existing "Upload files" pill alongside PDF/DOCX. Both paths produce the same timestamped-citation experience YouTube sources already have ("Watch at mm:ss").

Transcription uses OpenAI's `whisper-1` model specifically (not `gpt-4o-transcribe`, despite it being newer) because only `whisper-1` supports `timestamp_granularities`/`verbose_json` segment timestamps — `gpt-4o-transcribe` returns plain text with no timestamps at all, which would break the timestamped-citation requirement.

## Key decisions

- New shared helper `transcribeAudio()` in the OpenAI provider module (`src/lib/providers/openai.ts`, per ADR-006 — no direct SDK calls outside providers), calling `whisper-1` with `response_format: 'verbose_json'` and `timestamp_granularities: ['segment']`, returning `{ start: number; text: string }[]`.
- New shared grouping utility (extracted from the existing YouTube cue-grouping logic) turns any timestamped-segment list into ~30s `SourceBlock`s — used by both the audio adapter and the YouTube fallback path.
- New `audio` adapter (`src/lib/ingestion/adapters/audio.ts`): downloads the uploaded original from Storage (like the PDF/DOCX adapters), transcribes it, groups into blocks.
- YouTube adapter: on `YoutubeTranscriptDisabledError`/`NotAvailableError`, falls back to downloading the video's lowest-bitrate audio-only stream via `@distube/ytdl-core` (pure JS; no `yt-dlp` binary available in the serverless/Inngest runtime) and transcribing it, instead of immediately failing.
- Duration cap is enforced as a **file-size cap**, not a probed duration: OpenAI's transcription endpoint has a hard 25MB per-request limit regardless, and there's no `ffprobe` available serverless-side to measure duration directly. Both paths reject (non-retriably) audio over 25MB, which approximates the originally-wanted ~60 minute cap at typical bitrates.
- Direct audio uploads keep their original file in Storage (consistent with PDF/DOCX); YouTube fallback audio is transcribed in-memory and discarded, consistent with how YouTube sources already don't store the source video today.
- `sources.type` check constraint gains `'audio'`.

## Constraints

- Transcription must go through the provider abstraction (`src/lib/providers`), never call the OpenAI SDK directly from adapters.
- Ingestion stays one durable, independently retriable Inngest workflow per source; the transcription call happens inside the existing `parse` step.
- Existing per-notebook (10 sources) and per-file (10MB for PDF/DOCX) limits are untouched; audio uploads get their own 25MB cap tied to the transcription API's hard limit.
- No `ffmpeg`/`yt-dlp` binaries — everything must run in the Vercel serverless Next.js runtime.

## Out of scope

- Splitting/chunking audio longer than 25MB into multiple transcription requests to lift the size cap.
- Video sources with picture content (this is audio-only transcription; no visual analysis).
- Notebook-level and non-audio title generation (already shipped).
- Any UI for choosing whisper vs. other STT models — `whisper-1` is fixed/internal.

## Success criteria

- A user can upload an mp3/wav/m4a/webm/ogg file (≤25MB) via the existing "Upload files" pill and get a source with an LLM-generated title and timestamped citations.
- A YouTube URL whose video has no caption track ingests successfully via the audio fallback, producing the same timestamped "Watch at mm:ss" citation behavior as caption-based YouTube sources.
- YouTube videos whose lowest-bitrate audio still exceeds 25MB, or direct audio uploads over 25MB, fail with a clear source-level error — not a silent drop or pipeline crash.
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass.

## Expected files touched

- `src/lib/providers/openai.ts` — new `transcribeAudio()` export
- `src/lib/ingestion/blockGrouping.ts` (new) — shared timed-segment → `SourceBlock[]` grouping, extracted from `youtube.ts`
- `src/lib/ingestion/adapters/audio.ts` (new), `adapters/index.ts` (register `'audio'`)
- `src/lib/ingestion/adapters/youtube.ts` — add audio-fallback branch
- `src/lib/sources/index.ts` — extend `FILE_EXTENSION_TYPE` map + audio size cap
- `src/app/api/notebooks/[notebookId]/sources/route.ts` — audio-specific size limit branch
- `src/components/sources/add-source-dialog.tsx` — accept audio extensions in the file picker/drop zone
- `supabase/migrations/` — new migration adding `'audio'` to `sources.type` check constraint
- `package.json` — new dep `@distube/ytdl-core`
