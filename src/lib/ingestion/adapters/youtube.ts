import 'server-only';
import { Innertube } from 'youtubei.js';
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
  const innertube = await Innertube.create();
  const stream = await innertube.download(videoId, {
    type: 'audio',
    quality: 'bestefficiency',
    format: 'any',
  });
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TRANSCRIPTION_AUDIO_BYTES) {
      await reader.cancel();
      throw new NonRetriableError('Video audio exceeds the 25MB transcription limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function transcribeViaAudioFallback(videoId: string) {
  const audio = await downloadLowestBitrateAudio(videoId);
  const segments = await transcribeAudio(audio, `${videoId}.webm`);
  const blocks = groupTimedItemsIntoBlocks(segments);
  if (blocks.length === 0) {
    throw new NonRetriableError('Could not transcribe any speech from this video');
  }
  return { blocks };
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
        return transcribeViaAudioFallback(videoId);
      }
      throw err;
    }

    const blocks = groupTimedItemsIntoBlocks(cues.map((c) => ({ start: c.offset, text: c.text })));
    if (blocks.length === 0) {
      // youtube-transcript can resolve successfully with zero cues when a caption
      // track exists but its XML doesn't match the library's parser (format drift) —
      // treat that the same as "no captions" and fall back to audio transcription.
      return transcribeViaAudioFallback(videoId);
    }

    return { blocks };
  },
};
