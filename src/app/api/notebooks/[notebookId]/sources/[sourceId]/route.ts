import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteSource } from '@/lib/sources';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ notebookId: string; sourceId: string }> },
) {
  const { sourceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await deleteSource(supabase, sourceId);
  return new NextResponse(null, { status: 204 });
}
