import 'server-only';
import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const GENERATION_MODEL = 'gpt-4o-mini';

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

export async function generate({ system, prompt }: { system: string; prompt: string }): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: GENERATION_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}
