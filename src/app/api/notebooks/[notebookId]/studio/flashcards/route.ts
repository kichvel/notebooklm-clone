import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateNextFlashcard } from '@/lib/generation/studio';

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
  const { sourceIds, excludeChunkIds } = body ?? {};
  if (
    sourceIds !== undefined &&
    (!Array.isArray(sourceIds) || !sourceIds.every((id: unknown) => typeof id === 'string'))
  ) {
    return NextResponse.json({ error: 'sourceIds must be an array of strings' }, { status: 400 });
  }
  if (
    !Array.isArray(excludeChunkIds) ||
    !excludeChunkIds.every((id: unknown) => typeof id === 'string')
  ) {
    return NextResponse.json(
      { error: 'excludeChunkIds must be an array of strings' },
      { status: 400 },
    );
  }

  try {
    const result = await generateNextFlashcard(supabase, {
      notebookId,
      sourceIds,
      excludeChunkIds,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('generateNextFlashcard failed', { notebookId, error });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
