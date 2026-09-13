import 'server-only';
import ytdl from '@distube/ytdl-core';
import { NonRetriableError } from 'inngest';
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  type TranscriptResponse,
} from 'youtube-transcript';
import { transcribeAudio, MAX_TRANSCRIPTION_AUDIO_BYTES } from '@/lib/providers/openai';
import { groupTimedItemsIntoBlocks } from '../blockGrouping';
import type { SourceAdapter } from './types';

const VIDEO_ID_RE =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;

export function extractVideoId(url: string): string | null {
  const match = url.match(VIDEO_ID_RE);
  return match ? match[1] : null;
}

async function downloadLowestBitrateAudio(videoId: string): Promise<Buffer> {
  const stream = ytdl(videoId, { filter: 'audioonly', quality: 'lowestaudio' });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MAX_TRANSCRIPTION_AUDIO_BYTES) {
      stream.destroy();
      throw new NonRetriableError('Video audio exceeds the 25MB transcription limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

    const blocks = groupTimedItemsIntoBlocks(cues.map((c) => ({ start: c.offset, text: c.text })));
    if (blocks.length === 0) {
      throw new NonRetriableError('This video has no available transcript');
    }

    return { blocks };
  },
};
