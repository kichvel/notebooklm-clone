# Design Brief — Direct-to-storage file uploads + honest YouTube transcript failures

**Goal:** Users can upload large files (e.g. an 18MB/175-page PDF) as sources in production, and a YouTube source that fails to fetch a transcript gets a retriable, honest failure instead of a permanent false "no transcript" claim.
**Date:** 2026-09-16

## Shared understanding

Two independent production bugs, bundled into one plan because they surfaced in the same session:

**1. File uploads fail above ~4.5MB in production (but not on localhost).** Files are currently uploaded as multipart form data through `POST /api/notebooks/[notebookId]/sources` (`src/app/api/notebooks/[notebookId]/sources/route.ts`), which enforces its own `MAX_FILE_BYTES = 10MB`. In production (Vercel), the platform's serverless function request-body ceiling (~4.5MB, not configurable) kills the request before that check ever runs, so anything above ~4.5MB fails with a generic `!response.ok` error client-side (`notebook-workspace.tsx:113`) rather than the app's own clearer "skipped" message. The fix is to stop routing file bytes through the serverless function at all: the browser already holds an authenticated Supabase client (`src/lib/supabase/client.ts`), and the existing `storage.objects` RLS policy already permits a notebook owner to write under `sources/{notebookId}/*` without a `sources` row existing yet — so the client can upload directly to Supabase Storage, then register the source via a small JSON call.

**2. YouTube transcript fetches are falsely reported as "no transcript" in production.** `src/lib/ingestion/adapters/youtube.ts` uses `youtube-transcript`, which YouTube increasingly blocks from datacenter IPs (Vercel included) by omitting caption-track data from its response — indistinguishable, from our code's point of view, from a video that genuinely has no captions. Today this is thrown as a `NonRetriableError` with the message "This video has no available transcript," which is both a permanent failure (no retry) and potentially a false claim about the video. Confirmed root cause via `node_modules/youtube-transcript/dist/esm/index.js` — no code change there (it's a dependency), the fix is entirely in how our adapter treats the failure. No paid proxy service is in scope; this is an honesty + retriability fix, not a guaranteed unblock.

## Key decisions

**Upload architecture:**
- Client generates a UUID client-side, uploads the file directly to Supabase Storage at `sources/{notebookId}/{uuid}/original.{ext}` via the browser Supabase client — no new signed-URL-minting endpoint needed; existing RLS already scopes this to the notebook owner.
- `POST /api/notebooks/[notebookId]/sources` changes to accept a JSON registration body (`{id, filename, fileSize}`) for file sources, in place of receiving the file bytes. It still enforces auth, rate limiting, the global ceiling, and the per-notebook 10-source cap exactly as today.
- Size limit raised: 50MB for pdf/docx/md (matches Supabase Storage's default bucket ceiling, comfortably covers the reported 18MB file); audio stays at 25MB (an OpenAI Whisper limit, unrelated to Vercel) but moves to the same direct-upload path for consistency, since audio was equally exposed to the ~4.5MB Vercel ceiling before.
- The registration call verifies the object actually exists in Storage at the expected path with a size matching what's claimed, before inserting the `sources` row — the server never trusts the client's claimed size or the mere existence of a request.
- If registration fails validation (oversized, wrong type, limit reached), the just-uploaded Storage object is deleted so nothing orphaned lingers from a rejected upload.
- Pasted-text sources are unaffected (already JSON, already small).

**YouTube transcript failures:**
- Stop throwing `NonRetriableError` for "no captions found" — throw a normal (retriable) `Error` instead, so Inngest's existing default step retry/backoff (already configured implicitly on `ingestSource`, `src/lib/ingestion/index.ts:194`) spaces out a few attempts over time rather than failing permanently on the first blocked response.
- Reword the failure message to stop asserting a fact about the video that we can't actually verify (e.g. "Couldn't retrieve a transcript for this video" instead of "This video has no available transcript"), surfaced via the existing `onFailure` → `markSourceIngestionFailed` path once retries are exhausted.
- No proxy service, no header/client-context spoofing beyond what the library already does — those were considered and explicitly deferred (see Out of scope) since they're fragile and of uncertain benefit relative to their complexity.

## Constraints

- No new paid third-party services (proxy providers, transcript APIs) — explicitly ruled out by the user for this pass.
- Must not weaken the ownership/RLS model: client-side storage writes rely on existing RLS, not on trusting client-supplied notebook/source IDs as proof of access (per `CLAUDE.md` / `docs/ARCHITECTURE.md` §5).
- Existing per-notebook source cap, rate limiting, and global ceiling enforcement must keep working identically for file sources.

## Out of scope

- Raising file size limits beyond 50MB, or adding page-count/memory guards inside the PDF parser (`src/lib/ingestion/adapters/pdf.ts`).
- A cleanup sweep for Storage objects uploaded but never registered (client crash/closed tab mid-flow) — harmless orphaned bytes, not a security or quota issue; noted as a future follow-up only.
- Any paid residential/rotating-proxy integration for YouTube fetches, or reverse-engineering alternate InnerTube client contexts to dodge blocking — deferred as fragile and speculative.
- Guaranteeing YouTube transcript fetches succeed in production — this pass makes failures honest and retriable, not eliminated.

## Success criteria

- Uploading an 18MB, 175-page PDF succeeds in production (manually verified against the deployed app, not just locally).
- A file source that exceeds 50MB (or 25MB for audio) is rejected with a clear, specific message — never the generic "Something went wrong" toast.
- A rejected/oversized upload leaves no orphaned object in the `sources` Storage bucket.
- A YouTube source whose transcript fetch fails is retried by Inngest (visible in Inngest's run history as multiple attempts) before being marked failed, and its final failure message does not claim the video has no transcript when that wasn't actually confirmed.
- `npm run typecheck`, `npm run lint`, and `npm run test` stay green; `youtube.test.ts` and any upload-related tests are updated to match the new behavior, not deleted to dodge failures.

## Expected files touched

- `src/app/api/notebooks/[notebookId]/sources/route.ts` — replace multipart handling with JSON registration + Storage existence/size verification
- `src/lib/sources/index.ts` — `createFileSource` takes an already-uploaded storage path instead of a `Blob`; cleanup-on-rejection logic
- `src/app/notebooks/[notebookId]/notebook-workspace.tsx` — `handleAddFiles` uploads to Storage via the browser client first, then calls the registration endpoint
- `src/components/sources/add-source-dialog.tsx` — likely unchanged, but verify error surfacing still matches
- `src/lib/ingestion/adapters/youtube.ts` — retriable error + honest message
- `src/lib/ingestion/adapters/youtube.test.ts` — update expectations for the new error type/message
- `docs/ARCHITECTURE.md` — update §6/upload description if it documents the old multipart flow
