import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

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
    .select('id, title, created_at, updated_at')
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

export async function deleteNotebook(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('notebooks').delete().eq('id', id);
  if (error) throw error;
}
