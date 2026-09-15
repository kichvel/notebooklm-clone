'use client';

export type StudioFeature = 'flashcards' | 'quiz';

import { FlashcardsOutput } from './flashcards-output';
import { QuizOutput } from './quiz-output';

export function GenerationOutput({
  feature,
  notebookId,
  sourceIds,
}: {
  feature: StudioFeature;
  notebookId: string;
  sourceIds: string[];
}) {
  if (feature === 'flashcards') {
    return <FlashcardsOutput notebookId={notebookId} sourceIds={sourceIds} />;
  }
  return <QuizOutput notebookId={notebookId} sourceIds={sourceIds} />;
}
