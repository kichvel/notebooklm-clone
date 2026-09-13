'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotebookIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { NotebookCard, type NotebookSummary } from '@/components/notebooks/notebook-card';

export default function Home() {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/notebooks')
      .then((response) => (response.ok ? response.json() : []))
      .then((data: NotebookSummary[]) => {
        if (cancelled) return;
        setNotebooks(data);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/notebooks', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to create notebook');
      const notebook = await response.json();
      router.push(`/notebooks/${notebook.id}`);
    } catch {
      setError('Something went wrong creating your notebook. Please try again.');
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sourcebook</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button onClick={handleCreate} disabled={creating}>
            <PlusIcon />
            {creating ? 'Creating…' : 'New notebook'}
          </Button>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loaded && notebooks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-24 text-center">
          <NotebookIcon className="size-8 text-muted-foreground" />
          <h2 className="text-lg font-medium">Create your first notebook</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add sources, ask questions, and get grounded answers with inspectable citations.
          </p>
          <Button onClick={handleCreate} disabled={creating}>
            <PlusIcon />
            {creating ? 'Creating…' : 'New notebook'}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((notebook) => (
            <NotebookCard
              key={notebook.id}
              notebook={notebook}
              onRenamed={(updated) =>
                setNotebooks((current) => current.map((n) => (n.id === updated.id ? updated : n)))
              }
              onDeleted={(id) => setNotebooks((current) => current.filter((n) => n.id !== id))}
            />
          ))}
        </div>
      )}
    </main>
  );
}
