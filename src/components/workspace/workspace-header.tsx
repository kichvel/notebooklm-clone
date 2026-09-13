'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';

export function WorkspaceHeader({
  notebookId,
  title,
  onRenamed,
}: {
  notebookId: string;
  title: string;
  onRenamed: (title: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the draft in sync when the title changes externally
    setDraft(title);
  }, [title]);

  async function commitRename() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === title) {
      setDraft(title);
      return;
    }
    const response = await fetch(`/api/notebooks/${notebookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    if (response.ok) {
      onRenamed(next);
    } else {
      setDraft(title);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const response = await fetch('/api/notebooks', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to create notebook');
      const notebook = await response.json();
      router.push(`/notebooks/${notebook.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-3">
      <Button variant="ghost" size="icon" aria-label="Back to notebooks" render={<Link href="/" />}>
        <ArrowLeftIcon />
      </Button>

      {editing ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              setDraft(title);
              setEditing(false);
            }
          }}
          autoFocus
          className="max-w-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md px-2 py-1 text-lg font-medium hover:bg-accent hover:text-accent-foreground"
        >
          {title}
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <Button variant="outline" onClick={handleCreate} disabled={creating}>
          <PlusIcon />
          {creating ? 'Creating…' : 'New notebook'}
        </Button>
      </div>
    </header>
  );
}
