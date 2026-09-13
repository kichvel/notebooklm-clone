'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVerticalIcon, NotebookIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface NotebookSummary {
  id: string;
  title: string;
  updated_at: string;
}

function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function NotebookCard({
  notebook,
  onRenamed,
  onDeleted,
}: {
  notebook: NotebookSummary;
  onRenamed: (notebook: NotebookSummary) => void;
  onDeleted: (id: string) => void;
}) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState(notebook.title);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleRename(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`/api/notebooks/${notebook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error('Failed to rename notebook');
      const updated = await response.json();
      onRenamed(updated);
      setRenameOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/notebooks/${notebook.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete notebook');
      onDeleted(notebook.id);
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={() => router.push(`/notebooks/${notebook.id}`)}
        className="flex flex-1 flex-col gap-3 text-left"
      >
        <NotebookIcon className="size-6 text-primary" />
        <div className="flex flex-col gap-1">
          <span className="line-clamp-2 font-medium">{notebook.title}</span>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(notebook.updated_at)}</span>
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100 data-[popup-open]:opacity-100"
          aria-label={`Notebook options for ${notebook.title}`}
        >
          <MoreVerticalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setTitle(notebook.title);
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={handleRename} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Rename notebook</DialogTitle>
            </DialogHeader>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{notebook.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently deletes the notebook and all of its sources and conversation history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
