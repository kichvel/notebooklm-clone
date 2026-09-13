import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPastedTextSource } from '@/lib/sources';

export async function POST(request: NextRequest, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { title, text } = body ?? {};
  if (typeof title !== 'string' || !title || typeof text !== 'string' || !text) {
    return NextResponse.json({ error: 'title and text are required' }, { status: 400 });
  }

  const source = await createPastedTextSource(supabase, { notebookId, title, text });
  return NextResponse.json(source, { status: 201 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('sources')
    .select('id, title, type, status, failure_reason, created_at')
    .eq('notebook_id', notebookId)
    .is('deleted_at', null)
    .order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
