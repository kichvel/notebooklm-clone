import { NextRequest, NextResponse } from 'next/server';
import { MAX_TRANSCRIPTION_AUDIO_BYTES } from '@/lib/providers/openai';
import { createClient } from '@/lib/supabase/server';
import { createFileSource, createPastedTextSource } from '@/lib/sources';

const MAX_SOURCES_PER_NOTEBOOK = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'webm', 'ogg']);

async function handleFileUpload(
  request: NextRequest,
  supabase: Awaited<ReturnType<typeof createClient>>,
  notebookId: string,
) {
  const formData = await request.formData();
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
  }

  const { count: existingCount } = await supabase
    .from('sources')
    .select('id', { count: 'exact', head: true })
    .eq('notebook_id', notebookId)
    .is('deleted_at', null);

  const remainingSlots = Math.max(0, MAX_SOURCES_PER_NOTEBOOK - (existingCount ?? 0));

  const created: unknown[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  for (const file of files) {
    if (created.length >= remainingSlots) {
      skipped.push({ filename: file.name, reason: 'Notebook source limit reached' });
      continue;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const limit = AUDIO_EXTENSIONS.has(ext) ? MAX_TRANSCRIPTION_AUDIO_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) {
      skipped.push({ filename: file.name, reason: `File exceeds ${limit / (1024 * 1024)}MB limit` });
      continue;
    }
    try {
      const source = await createFileSource(supabase, {
        notebookId,
        filename: file.name,
        file,
      });
      created.push(source);
    } catch {
      skipped.push({ filename: file.name, reason: 'Unsupported or invalid file' });
    }
  }

  return NextResponse.json({ created, skipped }, { status: 201 });
}

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

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return handleFileUpload(request, supabase, notebookId);
  }

  const body = await request.json();
  const { title, text } = body ?? {};
  if (typeof text !== 'string' || !text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  const source = await createPastedTextSource(supabase, {
    notebookId,
    title: typeof title === 'string' ? title : undefined,
    text,
  });
  return NextResponse.json(source, { status: 201 });
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

  const { data, error } = await supabase
    .from('sources')
    .select('id, title, type, status, failure_reason, created_at')
    .eq('notebook_id', notebookId)
    .is('deleted_at', null)
    .order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
