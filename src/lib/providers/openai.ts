import 'server-only';
import OpenAI, { toFile } from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const GENERATION_MODEL = 'gpt-4o-mini';
export const CAPABLE_GENERATION_MODEL = 'gpt-4.1';
export const REASONING_GENERATION_MODEL = 'o4-mini';
const TRANSCRIPTION_MODEL = 'whisper-1';

// OpenAI's /audio/transcriptions endpoint limit per request
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 25 * 1024 * 1024;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function embed(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

export async function generate({
  system,
  prompt,
  model = GENERATION_MODEL,
}: {
  system: string;
  prompt: string;
  model?: string;
}): Promise<string> {
  const response = await getClient().chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}

export async function* generateStreaming({
  system,
  prompt,
  model,
  maxOutputTokens = 2048,
}: {
  system: string;
  prompt: string;
  model: string;
  maxOutputTokens?: number;
}): AsyncGenerator<{ type: 'reasoning' | 'answer'; text: string }> {
  const stream = await getClient().responses.create({
    model,
    instructions: system,
    input: prompt,
    reasoning: { effort: 'medium', summary: 'auto' },
    max_output_tokens: maxOutputTokens,
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === 'response.reasoning_summary_text.delta') {
      yield { type: 'reasoning', text: event.delta };
    } else if (event.type === 'response.output_text.delta') {
      yield { type: 'answer', text: event.delta };
    } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
      throw new Error(`Generation ${event.type}`);
    }
  }
}

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
