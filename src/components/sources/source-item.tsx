'use client';

import { useState } from 'react';
import {
  ClipboardIcon,
  FileAudio2Icon,
  FileIcon,
  FileTextIcon,
  FileType2Icon,
  LinkIcon,
  RotateCcwIcon,
  Trash2Icon,
  VideoIcon,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SourceSummary {
  id: string;
  title: string;
  type: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  failure_reason: string | null;
  created_at: string;
}

function StatusBadge({ status }: { status: SourceSummary['status'] }) {
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (status === 'ready') return null;
  return <Badge variant="outline">Processing…</Badge>;
}

const SOURCE_TYPE_ICONS: Record<string, typeof FileIcon> = {
  pdf: FileTextIcon,
  docx: FileType2Icon,
  txt: FileIcon,
  audio: FileAudio2Icon,
  website: LinkIcon,
  youtube: VideoIcon,
  pasted_text: ClipboardIcon,
};

function SourceTypeIcon({ type }: { type: string }) {
  const Icon = SOURCE_TYPE_ICONS[type] ?? FileIcon;
  return (
    <Icon data-testid={`source-icon-${type}`} className="size-4 shrink-0 text-muted-foreground" />
  );
}

export function SourceItem({
  source,
  selected,
  onSelectedChange,
  onRetry,
  onDelete,
}: {
  source: SourceSummary;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectable = source.status === 'ready';

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/50">
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => onSelectedChange(checked === true)}
        disabled={!selectable}
        aria-label={`Select ${source.title}`}
      />
      <SourceTypeIcon type={source.type} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{source.title}</span>
        {source.status === 'failed' && source.failure_reason && (
          <span className="truncate text-xs text-destructive">{source.failure_reason}</span>
        )}
      </div>
      <StatusBadge status={source.status} />
      {source.status === 'failed' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Retry ${source.title}`}
          onClick={() => onRetry(source.id)}
        >
          <RotateCcwIcon />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${source.title}`}
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2Icon />
      </Button>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{source.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This excludes the source from future questions. Existing answers keep the citations
              they already generated, marked as unavailable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                onDelete(source.id);
                setDeleteOpen(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
