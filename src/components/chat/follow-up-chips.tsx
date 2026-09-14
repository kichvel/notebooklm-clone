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
    <div className="mt-2 flex flex-wrap gap-2">
      {questions.map((question) => (
        <Button
          key={question}
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={disabled}
          onClick={() => onSelect(question)}
        >
          {question}
        </Button>
      ))}
    </div>
  );
}
