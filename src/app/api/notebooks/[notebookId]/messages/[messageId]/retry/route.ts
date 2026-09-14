import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { retryAnswer, NotebookBusyError, type AskQuestionEvent } from '@/lib/generation';

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ notebookId: string; messageId: string }> },
) {
  const { notebookId, messageId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: AskQuestionEvent) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }
      try {
        for await (const event of retryAnswer(supabase, { notebookId, messageId })) send(event);
      } catch (error) {
        if (error instanceof NotebookBusyError) {
          send({ type: 'error', message: error.message });
        } else {
          console.error('retryAnswer failed', { notebookId, messageId, error });
          send({ type: 'error', message: 'Failed to generate an answer' });
        }
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
