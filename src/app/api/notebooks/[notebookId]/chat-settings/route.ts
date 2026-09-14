import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { updateChatSettings } from '@/lib/notebooks';
import { CHAT_STYLES, CHAT_ANSWER_LENGTHS, MAX_CUSTOM_STYLE_LENGTH } from '@/lib/notebooks/chatSettings';

export async function PATCH(
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
  const { chatStyle, chatCustomStyle, chatAnswerLength } = body ?? {};

  if (!CHAT_STYLES.includes(chatStyle)) {
    return NextResponse.json({ error: 'chatStyle must be "default" or "custom"' }, { status: 400 });
  }
  if (!CHAT_ANSWER_LENGTHS.includes(chatAnswerLength)) {
    return NextResponse.json(
      { error: 'chatAnswerLength must be "shorter", "default", or "longer"' },
      { status: 400 },
    );
  }
  if (chatStyle === 'custom') {
    if (typeof chatCustomStyle !== 'string' || !chatCustomStyle.trim()) {
      return NextResponse.json(
        { error: 'chatCustomStyle is required when chatStyle is "custom"' },
        { status: 400 },
      );
    }
    if (chatCustomStyle.length > MAX_CUSTOM_STYLE_LENGTH) {
      return NextResponse.json(
        { error: `chatCustomStyle must be ${MAX_CUSTOM_STYLE_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }
  }

  const notebook = await updateChatSettings(supabase, notebookId, {
    chatStyle,
    chatCustomStyle: chatStyle === 'custom' ? chatCustomStyle : null,
    chatAnswerLength,
  });
  return NextResponse.json(notebook);
}
