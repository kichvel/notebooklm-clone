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
