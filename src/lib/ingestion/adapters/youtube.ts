import 'server-only';
import { NonRetriableError } from 'inngest';
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
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

export const youtubeAdapter: SourceAdapter = {
  async parse(_supabase, { originUrl }) {
    if (!originUrl) throw new Error('Missing origin_url');
    const videoId = extractVideoId(originUrl);
    if (!videoId) throw new NonRetriableError(`Could not extract a video ID from ${originUrl}`);

    let cues: TranscriptResponse[];
    try {
      cues = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (err) {
      if (
        err instanceof YoutubeTranscriptDisabledError ||
        err instanceof YoutubeTranscriptNotAvailableError
      ) {
        throw new NonRetriableError('This video has no available transcript');
      }
      throw err;
    }

    const blocks = groupTimedItemsIntoBlocks(cues.map((c) => ({ start: c.offset, text: c.text })));
    if (blocks.length === 0) {
      throw new NonRetriableError('This video has no available transcript');
    }

    return { blocks };
  },
};
