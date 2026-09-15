'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function WelcomeState({ hasProcessingSources }: { hasProcessingSources: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="text-3xl" aria-hidden>
        👋
      </span>
      <h2 className="text-2xl font-semibold">Let&rsquo;s start your notebook…</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Add sources, then ask a question to get grounded, cited answers.
      </p>

      {hasProcessingSources && (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Skeleton className="h-9 w-full rounded-full" />
          <Skeleton className="h-9 w-3/4 self-center rounded-full" />
        </div>
      )}
    </div>
  );
}
