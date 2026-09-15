import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createWebsiteSource } from '@/lib/sources';
import {
  checkRateLimit,
  checkGlobalCeiling,
  getClientIp,
  RateLimitExceededError,
  DailyCeilingExceededError,
} from '@/lib/abuse-prevention';

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
  const { url } = body ?? {};
  if (typeof url !== 'string' || !url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  try {
    const source = await createWebsiteSource(supabase, { notebookId, url });
    return NextResponse.json(source, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Invalid or unsupported URL' }, { status: 400 });
  }
}
