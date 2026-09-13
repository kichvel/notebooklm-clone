import 'server-only';
import { NonRetriableError } from 'inngest';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { safeFetchHtml } from '../url-safety';
import type { SourceAdapter } from './types';

export const websiteAdapter: SourceAdapter = {
  async parse(_supabase, { originUrl }) {
    if (!originUrl) throw new Error('Missing origin_url');

    const html = await safeFetchHtml(originUrl);
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();

    if (!article?.textContent?.trim()) {
      throw new NonRetriableError(
        'Could not extract readable content (JS-rendered or login-required page)',
      );
    }

    return { blocks: [{ text: article.textContent.trim(), section: article.title ?? undefined }] };
  },
};
