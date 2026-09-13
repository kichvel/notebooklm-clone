import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { ingestSource } from '@/lib/ingestion';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ingestSource],
});
