import 'server-only';
import { pastedTextAdapter } from './pastedText';
import { pdfAdapter } from './pdf';
import { docxAdapter } from './docx';
import { websiteAdapter } from './website';
import { youtubeAdapter } from './youtube';
import { audioAdapter } from './audio';
import type { SourceAdapter } from './types';

export type { SourceAdapter, SourceBlock, ParseContext } from './types';

export const adapters: Record<string, SourceAdapter> = {
  pasted_text: pastedTextAdapter,
  pdf: pdfAdapter,
  docx: docxAdapter,
  website: websiteAdapter,
  youtube: youtubeAdapter,
  audio: audioAdapter,
};

export function getAdapter(type: string): SourceAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`No ingestion adapter for source type "${type}"`);
  return adapter;
}
