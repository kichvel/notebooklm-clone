'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export type StudioFeature = 'study_guide' | 'flashcards' | 'quiz';

const FLASHCARDS = [
  { front: 'What is the main topic of these sources?', back: 'A concise synthesis of the notebook’s sources.' },
  { front: 'What is a key term worth remembering?', back: 'The specific term highlighted across your sources.' },
  { front: 'What open question remains?', back: 'A question the sources do not fully answer yet.' },
];

const QUIZ = [
  { question: 'Which statement best reflects the sources?', options: ['Option A', 'Option B', 'Option C'] },
  { question: 'What is emphasized most across the sources?', options: ['Option A', 'Option B', 'Option C'] },
  { question: 'Which claim would need more evidence?', options: ['Option A', 'Option B', 'Option C'] },
];

function StudyGuideOutput() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="font-medium">Study guide</h3>
      <p className="text-muted-foreground">A concise study guide distilled from your selected sources.</p>
      <ul className="list-disc pl-5">
        <li>Key concept one, with supporting detail from your sources.</li>
        <li>Key concept two, with supporting detail from your sources.</li>
        <li>Key concept three, with supporting detail from your sources.</li>
      </ul>
    </div>
  );
}

function FlashcardsOutput() {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());

  function toggle(index: number) {
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="font-medium">Flashcards</h3>
      <p className="text-muted-foreground">Click a card to flip to reveal the answer.</p>
      <div className="flex flex-col gap-2">
        {FLASHCARDS.map((card, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggle(i)}
            className="rounded-lg border border-border p-3 text-left hover:border-primary/40"
          >
            {flipped.has(i) ? card.back : card.front}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuizOutput() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="font-medium">Quiz</h3>
      <p className="text-muted-foreground">Sample questions generated from your selected sources.</p>
      <ol className="flex flex-col gap-3 pl-4">
        {QUIZ.map((item, i) => (
          <li key={i} className="list-decimal">
            <p className="font-medium">{item.question}</p>
            <ul className="mt-1 flex flex-col gap-1 pl-4">
              {item.options.map((option) => (
                <li key={option} className="list-disc text-muted-foreground">
                  {option}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GenerationOutput({ feature }: { feature: StudioFeature }) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- simulated generation delay for this stubbed feature
    setLoading(true);
    const timeout = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timeout);
  }, [feature]);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-1">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (feature === 'study_guide') return <StudyGuideOutput />;
  if (feature === 'flashcards') return <FlashcardsOutput />;
  return <QuizOutput />;
}
