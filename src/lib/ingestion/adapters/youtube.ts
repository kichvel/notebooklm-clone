import 'server-only';
import { NonRetriableError } from 'inngest';
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  type TranscriptResponse,
} from 'youtube-transcript';
import type { SourceAdapter, SourceBlock } from './types';

const VIDEO_ID_RE =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;

const BLOCK_DURATION_SECONDS = 30;

export function extractVideoId(url: string): string | null {
  const match = url.match(VIDEO_ID_RE);
  return match ? match[1] : null;
}

export function groupCuesIntoBlocks(cues: TranscriptResponse[]): SourceBlock[] {
  if (cues.length === 0) return [];

  const blocks: SourceBlock[] = [];
  let blockStart = cues[0].offset;
  let blockTexts: string[] = [];

  for (const cue of cues) {
    if (cue.offset - blockStart >= BLOCK_DURATION_SECONDS && blockTexts.length > 0) {
      blocks.push({ text: blockTexts.join(' ').trim(), startSeconds: blockStart });
      blockStart = cue.offset;
      blockTexts = [];
    }
    blockTexts.push(cue.text);
  }
  if (blockTexts.length > 0) {
    blocks.push({ text: blockTexts.join(' ').trim(), startSeconds: blockStart });
  }

  return blocks.filter((b) => b.text.length > 0);
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

    const blocks = groupCuesIntoBlocks(cues);
    if (blocks.length === 0) {
      throw new NonRetriableError('This video has no available transcript');
    }

    return { blocks };
  },
};
