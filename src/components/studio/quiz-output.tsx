'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CitationDrawer } from '@/components/chat/citation-drawer';
import { cn } from '@/lib/utils';
import type { StudioCitation } from '@/lib/generation/studio';

interface QuizItem {
  question: string;
  options: string[];
  correctIndex: number;
  citation: StudioCitation;
}

type Status = 'loading' | 'ready' | 'exhausted' | 'error';

export function QuizOutput({
  notebookId,
  sourceIds,
}: {
  notebookId: string;
  sourceIds?: string[];
}) {
  const [items, setItems] = useState<QuizItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [drawerCitation, setDrawerCitation] = useState<StudioCitation | null>(null);

  const sourceKey = (sourceIds ?? []).join(',');

  const fetchNext = useCallback(
    async (excludeChunkIds: string[]) => {
      setStatus('loading');
      try {
        const response = await fetch(`/api/notebooks/${notebookId}/studio/quiz`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceIds, excludeChunkIds }),
        });
        const data = await response.json();
        if (data.status === 'ok') {
          setItems((prev) => {
            const next = [...prev, ...data.items];
            setCursor(next.length - data.items.length);
            return next;
          });
          setStatus('ready');
        } else if (data.status === 'exhausted') {
          setStatus('exhausted');
        } else {
          setStatus('error');
        }
      } catch (error) {
        console.error('Failed to fetch quiz question', error);
        setStatus('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceIds is tracked via sourceKey below
    [notebookId, sourceKey],
  );

  const resetAndFetch = useCallback(() => {
    setItems([]);
    setCursor(0);
    setSelectedIndex(null);
    fetchNext([]);
  }, [fetchNext]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset + fetch when notebookId/sourceKey change
    resetAndFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset should only run when notebookId/sourceKey change
  }, [notebookId, sourceKey]);

  function handleSelect(index: number) {
    if (selectedIndex !== null) return;
    setSelectedIndex(index);
  }

  function handleNext() {
    setSelectedIndex(null);
    if (cursor + 1 < items.length) {
      setCursor((prev) => prev + 1);
      setStatus('ready');
      return;
    }
    const excludeChunkIds = [...new Set(items.map((item) => item.citation.chunkId))];
    fetchNext(excludeChunkIds);
  }

  const currentItem = items[cursor];
  const showQuestion = currentItem !== undefined && status !== 'exhausted';
  const isWrong = selectedIndex !== null && selectedIndex !== currentItem?.correctIndex;

  return (
    <div className="flex flex-col gap-3">
      {showQuestion ? (
        <>
          <p className="rounded-lg border border-border p-3 text-sm font-medium">
            {currentItem.question}
          </p>

          <div className="flex flex-col gap-2">
            {currentItem.options.map((option, index) => {
              const isCorrect = index === currentItem.correctIndex;
              const isSelected = index === selectedIndex;
              const answered = selectedIndex !== null;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleSelect(index)}
                  disabled={answered}
                  className={cn(
                    'w-full rounded-lg border p-2 text-left text-sm transition-colors',
                    !answered && 'border-border hover:bg-muted',
                    answered && isCorrect && 'border-green-600 bg-green-100 text-green-900',
                    answered &&
                      isSelected &&
                      !isCorrect &&
                      'border-red-600 bg-red-100 text-red-900',
                    answered && !isCorrect && !isSelected && 'border-border opacity-60',
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>

          {isWrong && (
            <button
              type="button"
              onClick={() => setDrawerCitation(currentItem.citation)}
              className="self-start text-xs text-primary underline underline-offset-4"
            >
              See source: {currentItem.citation.sourceTitle}
            </button>
          )}

          {selectedIndex !== null && (
            <Button type="button" onClick={handleNext} disabled={status === 'loading'}>
              Next question
            </Button>
          )}
        </>
      ) : status === 'loading' ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : status === 'exhausted' ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          You&apos;ve covered everything in the selected sources.
        </p>
      ) : status === 'error' ? (
        <p className="rounded-lg border border-border p-3 text-sm text-destructive">
          Something went wrong generating a quiz question. Please try again.
        </p>
      ) : null}

      <CitationDrawer
        citation={drawerCitation}
        onOpenChange={(open) => !open && setDrawerCitation(null)}
      />
    </div>
  );
}
