import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { streamAnswer, NotebookBusyError, type AskQuestionEvent } from '@/lib/generation';
import { resolveCitations } from '@/lib/citations';
import {
  checkRateLimit,
  checkGlobalCeiling,
  getClientIp,
  RateLimitExceededError,
  DailyCeilingExceededError,
} from '@/lib/abuse-prevention';

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

  try {
    await checkRateLimit('chatMessage', user.id, getClientIp(request));
    await checkGlobalCeiling();
  } catch (error) {
    if (error instanceof RateLimitExceededError || error instanceof DailyCeilingExceededError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

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
        if (error instanceof NotebookBusyError) {
          send({ type: 'error', message: error.message });
        } else {
          console.error('streamAnswer failed', { notebookId, error });
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
    .select('id, role, content, status, created_at, follow_up_questions, reasoning, source_id')
    .eq('notebook_id', notebookId)
    .order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const introSourceIds = [
    ...new Set((messages ?? []).flatMap((m) => (m.source_id ? [m.source_id] : []))),
  ];
  const { data: introSources } =
    introSourceIds.length > 0
      ? await supabase
          .from('sources')
          .select('id, title, original_filename, origin_url')
          .in('id', introSourceIds)
      : { data: [] };
  const introSourceById = new Map((introSources ?? []).map((s) => [s.id, s]));

  const withCitations = await Promise.all(
    (messages ?? []).map(async (message) => {
      const introSource = message.source_id ? introSourceById.get(message.source_id) : undefined;
      return {
        ...message,
        // A fresh page load is never watching an actively-streaming generation, so a
        // 'pending' row it sees can only be an abandoned attempt.
        status: message.status === 'pending' ? 'failed' : message.status,
        citations: message.role === 'assistant' ? await resolveCitations(supabase, message.id) : [],
        reasoning: message.role === 'assistant' ? message.reasoning : null,
        introSource: introSource
          ? {
              title: introSource.title,
              filename: introSource.original_filename ?? introSource.origin_url ?? null,
            }
          : null,
      };
    }),
  );

  return NextResponse.json(withCitations);
}
