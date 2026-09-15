'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CitationDrawer } from '@/components/chat/citation-drawer';
import type { StudioCitation } from '@/lib/generation/studio';

interface FlashcardItem {
  card: { front: string; back: string };
  citation: StudioCitation;
}

type Status = 'loading' | 'ready' | 'exhausted' | 'error';

export function FlashcardsOutput({
  notebookId,
  sourceIds,
}: {
  notebookId: string;
  sourceIds?: string[];
}) {
  const [items, setItems] = useState<FlashcardItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [drawerCitation, setDrawerCitation] = useState<StudioCitation | null>(null);

  const sourceKey = (sourceIds ?? []).join(',');

  const fetchNext = useCallback(
    async (excludeChunkIds: string[]) => {
      setStatus('loading');
      try {
        const response = await fetch(`/api/notebooks/${notebookId}/studio/flashcards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceIds, excludeChunkIds }),
        });
        const data = await response.json();
        if (data.status === 'ok') {
          setItems((prev) => {
            const next = [...prev, { card: data.card, citation: data.citation }];
            setCursor(next.length - 1);
            return next;
          });
          setStatus('ready');
        } else if (data.status === 'exhausted') {
          setStatus('exhausted');
        } else {
          setStatus('error');
        }
      } catch (error) {
        console.error('Failed to fetch flashcard', error);
        setStatus('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceIds is tracked via sourceKey below
    [notebookId, sourceKey],
  );

  const resetAndFetch = useCallback(() => {
    setItems([]);
    setCursor(0);
    setFlipped(false);
    fetchNext([]);
  }, [fetchNext]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset + fetch when notebookId/sourceKey change
    resetAndFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset should only run when notebookId/sourceKey change
  }, [notebookId, sourceKey]);

  function handleNext() {
    setFlipped(false);
    if (cursor + 1 < items.length) {
      setCursor((prev) => prev + 1);
      setStatus('ready');
      return;
    }
    const excludeChunkIds = items.map((item) => item.citation.chunkId);
    fetchNext(excludeChunkIds);
  }

  const currentItem = items[cursor];
  const showCard = currentItem !== undefined && status !== 'exhausted';

  return (
    <div className="flex flex-col gap-3">
      {showCard ? (
        <>
          <button
            type="button"
            onClick={() => setFlipped((prev) => !prev)}
            className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-border p-3 text-center text-sm"
          >
            <span className="text-xs text-muted-foreground">
              {flipped ? 'Answer (click to flip back)' : 'Question (click to flip)'}
            </span>
            <span className="text-base font-medium">
              {flipped ? currentItem.card.back : currentItem.card.front}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDrawerCitation(currentItem.citation)}
            className="self-start text-xs text-primary underline underline-offset-4"
          >
            Source: {currentItem.citation.sourceTitle}
          </button>

          <Button type="button" onClick={handleNext} disabled={status === 'loading'}>
            Next
          </Button>
        </>
      ) : status === 'loading' ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : status === 'exhausted' ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          You&apos;ve covered everything in the selected sources.
        </p>
      ) : status === 'error' ? (
        <p className="rounded-lg border border-border p-3 text-sm text-destructive">
          Something went wrong generating a flashcard. Please try again.
        </p>
      ) : null}

      <CitationDrawer
        citation={drawerCitation}
        onOpenChange={(open) => !open && setDrawerCitation(null)}
      />
    </div>
  );
}
