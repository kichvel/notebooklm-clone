'use client';

import { useState } from 'react';
import { SparklesIcon, LayersIcon, HelpCircleIcon } from 'lucide-react';
import { FeatureCard } from './feature-card';
import { GenerationOutput, type StudioFeature } from './generation-output';

const FEATURES: {
  feature: StudioFeature;
  label: string;
  icon: typeof LayersIcon;
  tint: 'blue' | 'green' | 'purple';
}[] = [
  { feature: 'flashcards', label: 'Flashcards', icon: LayersIcon, tint: 'purple' },
  { feature: 'quiz', label: 'Quiz', icon: HelpCircleIcon, tint: 'green' },
];

export function StudioPanel({
  notebookId,
  readySourceCount,
  selectedSourceIds,
}: {
  notebookId: string;
  readySourceCount: number;
  selectedSourceIds: Set<string>;
}) {
  const [activeFeature, setActiveFeature] = useState<StudioFeature | null>(null);
  const disabled = readySourceCount === 0;
  const sourceIds = [...selectedSourceIds];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-2">
        {FEATURES.map(({ feature, label, icon, tint }) => (
          <FeatureCard
            key={feature}
            icon={icon}
            label={label}
            tint={tint}
            disabled={disabled}
            onClick={() => setActiveFeature(feature)}
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeFeature ? (
          <GenerationOutput
            key={`${notebookId}-${activeFeature}-${sourceIds.join(',')}`}
            feature={activeFeature}
            notebookId={notebookId}
            sourceIds={sourceIds}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <SparklesIcon className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Studio output will be displayed here.</p>
            <p className="max-w-[220px] text-xs text-muted-foreground">
              {disabled
                ? 'Add and process sources first, then generate flashcards or a quiz.'
                : 'Pick a card above to generate flashcards or a quiz.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
