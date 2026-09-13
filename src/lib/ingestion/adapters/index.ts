import 'server-only';
import { pastedTextAdapter } from './pastedText';
import { pdfAdapter } from './pdf';
import { docxAdapter } from './docx';
import type { SourceAdapter } from './types';

export type { SourceAdapter, SourceBlock, ParseContext } from './types';

export const adapters: Record<string, SourceAdapter> = {
  pasted_text: pastedTextAdapter,
  pdf: pdfAdapter,
  docx: docxAdapter,
};

export function getAdapter(type: string): SourceAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`No ingestion adapter for source type "${type}"`);
  return adapter;
}
