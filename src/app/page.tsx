'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/notebooks', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to create notebook');
      const notebook = await response.json();
      router.push(`/notebooks/${notebook.id}`);
    } catch {
      setError('Something went wrong creating your notebook. Please try again.');
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-black">
      <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">Sourcebook</h1>
      <p className="max-w-md text-center text-zinc-600 dark:text-zinc-400">
        Add sources, ask questions, and get grounded answers with inspectable citations.
      </p>
      <button
        onClick={handleCreate}
        disabled={loading}
        className="rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-[#383838] disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {loading ? 'Creating…' : 'New notebook'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
