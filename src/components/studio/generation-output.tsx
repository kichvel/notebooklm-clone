'use client';

export type StudioFeature = 'flashcards' | 'quiz';

// TODO(task 3/4/5): replace with real router for grounded flashcards/quiz generation
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- feature param kept for the stable signature; unused until the router is implemented
export function GenerationOutput({ feature }: { feature: StudioFeature }) {
  return null;
}
