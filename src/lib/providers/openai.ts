import 'server-only';
import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';

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
