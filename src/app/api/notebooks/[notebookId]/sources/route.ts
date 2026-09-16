import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createFileSource, createPastedTextSource } from '@/lib/sources';
import {
  checkRateLimit,
  checkGlobalCeiling,
  getClientIp,
  RateLimitExceededError,
  DailyCeilingExceededError,
} from '@/lib/abuse-prevention';

const MAX_SOURCES_PER_NOTEBOOK = 10;

async function handleFileRegistration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notebookId: string,
  files: { id: string; filename: string }[],
) {
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
      skipped.push({ filename: file.filename, reason: 'Notebook source limit reached' });
      continue;
    }
    try {
      const source = await createFileSource(supabase, {
        notebookId,
        id: file.id,
        filename: file.filename,
      });
      created.push(source);
    } catch (err) {
      skipped.push({
        filename: file.filename,
        reason: err instanceof Error ? err.message : 'Unsupported or invalid file',
      });
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

  try {
    await checkRateLimit('sourceCreate', user.id, getClientIp(request));
    await checkGlobalCeiling();
  } catch (error) {
    if (error instanceof RateLimitExceededError || error instanceof DailyCeilingExceededError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  const body = await request.json();
  if (Array.isArray(body?.files)) {
    return handleFileRegistration(supabase, notebookId, body.files);
  }

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
    .select('id, title, type, status, failure_reason, created_at, intro_generated_at')
    .eq('notebook_id', notebookId)
    .is('deleted_at', null)
    .order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
