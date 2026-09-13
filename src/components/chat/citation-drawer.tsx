'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

export interface Citation {
  label: number;
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number | null;
  pageNumber: number | null;
  section: string | null;
  startSeconds: number | null;
  sourceUrl: string | null;
  content: string;
}

function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function citationLocation(citation: Citation) {
  if (citation.startSeconds !== null) return `${formatTimestamp(citation.startSeconds)}`;
  if (citation.section) return citation.section;
  if (citation.pageNumber !== null) return `Page ${citation.pageNumber}`;
  if (citation.chunkIndex !== null) return `Passage ${citation.chunkIndex + 1}`;
  return null;
}

export function CitationDrawer({
  citation,
  onOpenChange,
}: {
  citation: Citation | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={citation !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        {citation && (
          <>
            <SheetHeader>
              <SheetTitle>{citation.sourceTitle}</SheetTitle>
              {citationLocation(citation) && (
                <SheetDescription>{citationLocation(citation)}</SheetDescription>
              )}
            </SheetHeader>
            <p className="whitespace-pre-wrap px-4 text-sm">{citation.content}</p>
            {citation.sourceUrl && (
              <a
                href={citation.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 text-sm text-primary underline underline-offset-4"
              >
                Watch at {formatTimestamp(citation.startSeconds!)} ↗
              </a>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
