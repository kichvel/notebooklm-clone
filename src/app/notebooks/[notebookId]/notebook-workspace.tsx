'use client';

import { useEffect, useState } from 'react';

interface Source {
  id: string;
  title: string;
  type: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  failure_reason: string | null;
  created_at: string;
}

const ACTIVE_STATUSES = new Set(['uploaded', 'processing']);

export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshSources() {
    const response = await fetch(`/api/notebooks/${notebookId}/sources`);
    if (!response.ok) return;
    setSources(await response.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    refreshSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  useEffect(() => {
    const hasActiveSource = sources.some((source) => ACTIVE_STATUSES.has(source.status));
    if (!hasActiveSource) return;
    const interval = setInterval(refreshSources, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  async function handleAddSource(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text }),
      });
      if (!response.ok) throw new Error('Failed to add source');
      setTitle('');
      setText('');
      await refreshSources();
    } catch {
      setError('Something went wrong adding that source. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold">Notebook</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Sources</h2>
        <form onSubmit={handleAddSource} className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Source title"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
            required
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text here"
            rows={6}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
            required
          />
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-full bg-black px-5 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {submitting ? 'Adding…' : 'Add source'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <ul className="flex flex-col gap-2">
          {sources.map((source) => (
            <li
              key={source.id}
              className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <span>{source.title}</span>
              <span className="text-sm text-zinc-500">
                {source.status}
                {source.status === 'failed' && source.failure_reason ? ` — ${source.failure_reason}` : ''}
              </span>
            </li>
          ))}
          {sources.length === 0 && <li className="text-sm text-zinc-500">No sources yet.</li>}
        </ul>
      </section>
    </main>
  );
}
