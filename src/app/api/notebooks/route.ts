import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createNotebook, listNotebooks } from '@/lib/notebooks';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const notebook = await createNotebook(supabase);
  return NextResponse.json(notebook, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const notebooks = await listNotebooks(supabase);
  return NextResponse.json(notebooks);
}
