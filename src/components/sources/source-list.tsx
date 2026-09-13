'use client';

import { FileTextIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { SourceItem, type SourceSummary } from './source-item';

export function SourceList({
  sources,
  selectedIds,
  onSelectionChange,
  onRetry,
  onDelete,
}: {
  sources: SourceSummary[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const readySources = sources.filter((s) => s.status === 'ready');
  const allSelected = readySources.length > 0 && readySources.every((s) => selectedIds.has(s.id));

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      onSelectionChange(new Set(readySources.map((s) => s.id)));
    } else {
      onSelectionChange(new Set());
    }
  }

  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <FileTextIcon className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Saved sources will appear here</p>
          <p className="text-xs text-muted-foreground">
            Add files or pasted text, then ask questions based on these sources.
          </p>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => toggleSelectAll(checked === true)}
              disabled={readySources.length === 0}
            />
            Select all
          </label>
          <div className="flex flex-col gap-1">
            {sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                selected={selectedIds.has(source.id)}
                onSelectedChange={(checked) => toggleOne(source.id, checked)}
                onRetry={onRetry}
                onDelete={onDelete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export type { SourceSummary };
