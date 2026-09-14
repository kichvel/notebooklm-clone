import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { streamAnswer, type AskQuestionEvent } from '@/lib/generation';
import { resolveCitations } from '@/lib/citations';

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { question, sourceIds } = body ?? {};
  if (typeof question !== 'string' || !question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }
  if (
    sourceIds !== undefined &&
    (!Array.isArray(sourceIds) || !sourceIds.every((id) => typeof id === 'string'))
  ) {
    return NextResponse.json({ error: 'sourceIds must be an array of strings' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: AskQuestionEvent) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }
      try {
        for await (const event of streamAnswer(supabase, { notebookId, question, sourceIds })) {
          send(event);
        }
      } catch (error) {
        console.error('streamAnswer failed', { notebookId, error });
        send({ type: 'error', message: 'Failed to generate an answer' });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, role, content, status, created_at, follow_up_questions, reasoning')
    .eq('notebook_id', notebookId)
    .order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withCitations = await Promise.all(
    (messages ?? []).map(async (message) => ({
      ...message,
      citations: message.role === 'assistant' ? await resolveCitations(supabase, message.id) : [],
      reasoning: message.role === 'assistant' ? message.reasoning : null,
    })),
  );

  return NextResponse.json(withCitations);
}
