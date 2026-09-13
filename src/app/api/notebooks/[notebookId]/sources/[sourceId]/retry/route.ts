import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { retrySource } from '@/lib/sources';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ notebookId: string; sourceId: string }> },
) {
  const { sourceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const source = await retrySource(supabase, sourceId);
  return NextResponse.json(source);
}
