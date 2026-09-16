import 'server-only';
import { NonRetriableError } from 'inngest';
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  type TranscriptResponse,
} from 'youtube-transcript';
import { groupTimedItemsIntoBlocks } from '../blockGrouping';
import type { SourceAdapter } from './types';

const VIDEO_ID_RE =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;

export function extractVideoId(url: string): string | null {
  const match = url.match(VIDEO_ID_RE);
  return match ? match[1] : null;
}

// YouTube only exposes a caption track per spoken language; it has no notion of an
// "English track" for videos captioned in another language. Its timedtext endpoint
// can machine-translate any track on the fly via `tlang`, which is what the "Auto-translate"
// option in YouTube's own CC menu uses, so we ask for that whenever there is no native
// English track to fall back on.
function withEnglishTranslation(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('/api/timedtext') && !/[?&]tlang=/.test(url)) {
    return fetch(`${url}&tlang=en`, init);
  }
  return fetch(input, init);
}

async function fetchEnglishTranscript(videoId: string): Promise<TranscriptResponse[]> {
  try {
    return await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
  } catch (err) {
    if (!(err instanceof YoutubeTranscriptNotAvailableLanguageError)) throw err;
    return YoutubeTranscript.fetchTranscript(videoId, { fetch: withEnglishTranslation });
  }
}

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
        // Not distinguishable from here: YouTube returns the same "no caption tracks"
        // response both for videos that genuinely lack captions and when it blocks our
        // server's IP. Retriable (not NonRetriableError) so Inngest's backoff gives a
        // blocked request a few spaced-out attempts instead of failing permanently on one.
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
