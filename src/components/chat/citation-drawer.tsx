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
  content: string;
}

function citationLocation(citation: Citation) {
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
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
