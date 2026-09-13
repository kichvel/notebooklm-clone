import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { askQuestion } from '@/lib/generation';
import { resolveCitations } from '@/lib/citations';

export async function POST(request: NextRequest, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { question } = body ?? {};
  if (typeof question !== 'string' || !question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const result = await askQuestion(supabase, { notebookId, question });
  return NextResponse.json(result, { status: 201 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, role, content, status, created_at')
    .eq('notebook_id', notebookId)
    .order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withCitations = await Promise.all(
    (messages ?? []).map(async (message) => ({
      ...message,
      citations: message.role === 'assistant' ? await resolveCitations(supabase, message.id) : [],
    })),
  );

  return NextResponse.json(withCitations);
}
