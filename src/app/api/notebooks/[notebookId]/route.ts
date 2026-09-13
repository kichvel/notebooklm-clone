import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNotebook, renameNotebook, deleteNotebook } from '@/lib/notebooks';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const notebook = await getNotebook(supabase, notebookId);
  return NextResponse.json(notebook);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { title } = body ?? {};
  if (typeof title !== 'string' || !title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const notebook = await renameNotebook(supabase, notebookId, title);
  return NextResponse.json(notebook);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await deleteNotebook(supabase, notebookId);
  return new NextResponse(null, { status: 204 });
}
