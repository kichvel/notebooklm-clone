'use client';

import { Button } from '@/components/ui/button';

export function FollowUpChips({
  questions,
  onSelect,
  disabled,
}: {
  questions: string[];
  onSelect: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 flex min-w-0 max-w-full flex-col items-start gap-2">
      {questions.map((question) => (
        <Button
          key={question}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto max-w-full min-w-0 rounded-full py-1.5 text-left whitespace-normal"
          disabled={disabled}
          onClick={() => onSelect(question)}
        >
          {question}
        </Button>
      ))}
    </div>
  );
}
