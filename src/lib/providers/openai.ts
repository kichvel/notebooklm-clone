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

// The embeddings endpoint accepts an array of inputs in a single request, so batching
// avoids one HTTP round trip per chunk when embedding an entire source at ingestion time.
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
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

const FOLLOW_UP_QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const;

export async function generateFollowUpQuestions({
  system,
  prompt,
  model = GENERATION_MODEL,
}: {
  system: string;
  prompt: string;
  model?: string;
}): Promise<string[]> {
  const response = await getClient().chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'follow_up_questions',
        strict: true,
        schema: FOLLOW_UP_QUESTIONS_SCHEMA,
      },
    },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return [];
  const parsed = JSON.parse(content) as { questions?: unknown };
  if (!Array.isArray(parsed.questions)) return [];
  const questions = parsed.questions.filter(
    (q): q is string => typeof q === 'string' && q.trim().length > 0,
  );
  return questions.length === 3 ? questions : [];
}

const FLASHCARDS_SCHEMA = {
  type: 'object',
  properties: {
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { front: { type: 'string' }, back: { type: 'string' } },
        required: ['front', 'back'],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 2,
    },
  },
  required: ['flashcards'],
  additionalProperties: false,
} as const;

interface RawFlashcard {
  front?: unknown;
  back?: unknown;
}

function isValidFlashcard(card: RawFlashcard): card is { front: string; back: string } {
  return (
    typeof card.front === 'string' &&
    typeof card.back === 'string' &&
    card.front.trim().length > 0 &&
    card.back.trim().length > 0
  );
}

export async function generateFlashcards({
  system,
  prompt,
  model = GENERATION_MODEL,
}: {
  system: string;
  prompt: string;
  model?: string;
}): Promise<{ front: string; back: string }[] | null> {
  const response = await getClient().chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'flashcards', strict: true, schema: FLASHCARDS_SCHEMA },
    },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(content) as { flashcards?: RawFlashcard[] };
  if (!Array.isArray(parsed.flashcards) || parsed.flashcards.length !== 2) return null;
  const cards = parsed.flashcards.filter(isValidFlashcard);
  return cards.length === 2 ? cards : null;
}

const QUIZ_QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
        },
        required: ['question', 'options', 'correctIndex'],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 2,
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const;

interface RawQuizQuestion {
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
}

function isValidQuizQuestion(
  question: RawQuizQuestion,
): question is { question: string; options: string[]; correctIndex: number } {
  return (
    typeof question.question === 'string' &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((o): o is string => typeof o === 'string' && o.trim().length > 0) &&
    typeof question.correctIndex === 'number' &&
    question.correctIndex >= 0 &&
    question.correctIndex <= 3
  );
}

export async function generateQuizQuestions({
  system,
  prompt,
  model = GENERATION_MODEL,
}: {
  system: string;
  prompt: string;
  model?: string;
}): Promise<{ question: string; options: string[]; correctIndex: number }[] | null> {
  const response = await getClient().chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'quiz_questions', strict: true, schema: QUIZ_QUESTIONS_SCHEMA },
    },
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(content) as { questions?: RawQuizQuestion[] };
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 2) return null;
  const questions = parsed.questions.filter(isValidQuizQuestion);
  return questions.length === 2 ? questions : null;
}

// Thrown when the model run ends before producing a complete response (most commonly:
// reasoning consumed the entire max_output_tokens budget before any answer text was emitted).
// Kept distinct from a hard provider failure so callers can surface a specific, retryable
// message instead of a generic error.
export class GenerationIncompleteError extends Error {
  constructor(reason: string) {
    super(`Generation ended before finishing (${reason})`);
    this.name = 'GenerationIncompleteError';
  }
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
    } else if (event.type === 'response.incomplete') {
      throw new GenerationIncompleteError(event.response.incomplete_details?.reason ?? 'unknown');
    } else if (event.type === 'response.failed') {
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
