import 'server-only';
import type { createServiceClient } from '@/lib/supabase/server';

export interface SourceBlock {
  text: string;
  page?: number;
  section?: string;
  startSeconds?: number;
}

export interface ParseContext {
  sourceId: string;
  storagePath: string | null;
  originUrl: string | null;
}

export interface SourceAdapter {
  parse(
    supabase: ReturnType<typeof createServiceClient>,
    context: ParseContext,
  ): Promise<{ blocks: SourceBlock[] }>;
}
