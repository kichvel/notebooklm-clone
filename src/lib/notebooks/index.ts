import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatSettings } from './chatSettings';

export async function createNotebook(supabase: SupabaseClient, title?: string) {
  const { data, error } = await supabase
    .from('notebooks')
    .insert(title ? { title } : {})
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getNotebook(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from('notebooks')
    .select('id, title, created_at, updated_at, chat_style, chat_custom_style, chat_answer_length')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function listNotebooks(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('notebooks')
    .select('id, title, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function renameNotebook(supabase: SupabaseClient, id: string, title: string) {
  const { data, error } = await supabase
    .from('notebooks')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateChatSettings(
  supabase: SupabaseClient,
  id: string,
  { chatStyle, chatCustomStyle, chatAnswerLength }: ChatSettings,
) {
  const { data, error } = await supabase
    .from('notebooks')
    .update({
      chat_style: chatStyle,
      chat_custom_style: chatCustomStyle,
      chat_answer_length: chatAnswerLength,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteNotebook(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('notebooks').delete().eq('id', id);
  if (error) throw error;
}
