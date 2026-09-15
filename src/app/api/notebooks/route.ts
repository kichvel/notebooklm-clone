import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createNotebook, listNotebooks } from '@/lib/notebooks';
import { checkRateLimit, getClientIp, RateLimitExceededError } from '@/lib/abuse-prevention';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await checkRateLimit('notebookCreate', user.id, getClientIp(request));
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

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
