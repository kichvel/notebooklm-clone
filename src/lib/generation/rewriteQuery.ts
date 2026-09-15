import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generate } from '@/lib/providers/openai';

export const RECENT_MESSAGE_WINDOW = 6;

export interface RecentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function fetchRecentMessages(
  supabase: SupabaseClient,
  notebookId: string,
): Promise<RecentMessage[]> {
  const { data: recent, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('notebook_id', notebookId)
    .order('created_at', { ascending: false })
    .limit(RECENT_MESSAGE_WINDOW);
  if (error) throw error;
  return [...(recent ?? [])].reverse() as RecentMessage[];
}

const REWRITE_SYSTEM_PROMPT = [
  "You rewrite a user's latest question into a standalone question that can be understood",
  'without the conversation above, resolving pronouns and implicit references ("the other one",',
  '"what about X") against it. If the question already stands alone, return it unchanged.',
  'Respond with ONLY the rewritten question and nothing else.',
].join(' ');

export async function rewriteFollowUpQuery(
  history: RecentMessage[],
  question: string,
): Promise<string> {
  if (history.length === 0) return question;

  const historyText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const rewritten = (
    await generate({
      system: REWRITE_SYSTEM_PROMPT,
      prompt: `Conversation so far:\n${historyText}\n\nLatest question: ${question}`,
    })
  ).trim();
  return rewritten || question;
}
