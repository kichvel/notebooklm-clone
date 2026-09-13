'use client';

import { useEffect, useRef, useState } from 'react';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { SourceList } from '@/components/sources/source-list';
import { AddSourceDialog } from '@/components/sources/add-source-dialog';
import type { SourceSummary as Source } from '@/components/sources/source-item';

interface Citation {
  label: number;
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number | null;
  pageNumber: number | null;
  section: string | null;
  content: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'refused' | 'failed';
  created_at: string;
  citations: Citation[];
}

const ACTIVE_STATUSES = new Set(['uploaded', 'processing']);

function AnswerText({ content, citations }: { content: string; citations: Citation[] }) {
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const byLabel = new Map(citations.map((c) => [c.label, c]));
  const parts = content.split(/(\[\d+\])/g);

  return (
    <>
      <p className="whitespace-pre-wrap">
        {parts.map((part, i) => {
          const match = part.match(/^\[(\d+)\]$/);
          const citation = match ? byLabel.get(Number(match[1])) : undefined;
          if (!citation) return <span key={i}>{part}</span>;
          return (
            <button
              key={i}
              onClick={() => setOpenCitation(citation)}
              className="mx-0.5 rounded bg-zinc-200 px-1 text-sm font-medium hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
            >
              {part}
            </button>
          );
        })}
      </p>

      {openCitation && (
        <div className="fixed inset-y-0 right-0 w-full max-w-sm overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <button
            onClick={() => setOpenCitation(null)}
            className="mb-4 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Close
          </button>
          <h3 className="font-semibold">{openCitation.sourceTitle}</h3>
          <p className="mt-1 text-sm text-zinc-500">
            {openCitation.section ??
              (openCitation.pageNumber !== null
                ? `Page ${openCitation.pageNumber}`
                : openCitation.chunkIndex !== null
                  ? `Passage ${openCitation.chunkIndex + 1}`
                  : null)}
          </p>
          <p className="mt-4 whitespace-pre-wrap text-sm">{openCitation.content}</p>
        </div>
      )}
    </>
  );
}

export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const [notebookTitle, setNotebookTitle] = useState('Untitled notebook');
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const knownReadyIds = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function refreshNotebook() {
    const response = await fetch(`/api/notebooks/${notebookId}`);
    if (!response.ok) return;
    const notebook = await response.json();
    setNotebookTitle(notebook.title);
  }

  async function refreshSources() {
    const response = await fetch(`/api/notebooks/${notebookId}/sources`);
    if (!response.ok) return;
    const next: Source[] = await response.json();
    setSources(next);

    const newlyReady = next
      .filter((s) => s.status === 'ready' && !knownReadyIds.current.has(s.id))
      .map((s) => s.id);
    if (newlyReady.length > 0) {
      setSelectedSourceIds((current) => new Set([...current, ...newlyReady]));
    }
    knownReadyIds.current = new Set(next.filter((s) => s.status === 'ready').map((s) => s.id));
  }

  async function refreshMessages() {
    const response = await fetch(`/api/notebooks/${notebookId}/messages`);
    if (!response.ok) return;
    setMessages(await response.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    refreshNotebook();
    refreshSources();
    refreshMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  useEffect(() => {
    const hasActiveSource = sources.some((source) => ACTIVE_STATUSES.has(source.status));
    if (!hasActiveSource) return;
    const interval = setInterval(refreshSources, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  async function handleAddSource({ title, text }: { title: string; text: string }) {
    setError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text }),
      });
      if (!response.ok) throw new Error('Failed to add source');
      await refreshSources();
    } catch (err) {
      setError('Something went wrong adding that source. Please try again.');
      throw err;
    }
  }

  async function handleRetry(sourceId: string) {
    const response = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/retry`, { method: 'POST' });
    if (response.ok) await refreshSources();
  }

  async function handleDeleteSource(sourceId: string) {
    const response = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}`, { method: 'DELETE' });
    if (response.ok) {
      setSelectedSourceIds((current) => {
        const next = new Set(current);
        next.delete(sourceId);
        return next;
      });
      await refreshSources();
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    setAsking(true);
    setAskError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, sourceIds: [...selectedSourceIds] }),
      });
      if (!response.ok) throw new Error('Failed to ask question');
      setQuestion('');
      await refreshMessages();
    } catch {
      setAskError('Something went wrong asking that question. Please try again.');
    } finally {
      setAsking(false);
    }
  }

  const sourcesPanel = (
    <div className="flex flex-col gap-2">
      <div className="px-3 pt-3">
        <AddSourceDialog onAdd={handleAddSource} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
      <SourceList
        sources={sources}
        selectedIds={selectedSourceIds}
        onSelectionChange={setSelectedSourceIds}
        onRetry={handleRetry}
        onDelete={handleDeleteSource}
      />
    </div>
  );

  const chatPanel = (
    <section className="flex flex-1 flex-col gap-3 p-4">
      <h2 className="text-lg font-medium">Chat</h2>

      <ul className="flex flex-col gap-4">
        {messages.map((message) => (
          <li key={message.id} className={message.role === 'user' ? 'font-medium' : ''}>
            {message.role === 'assistant' ? (
              <AnswerText content={message.content} citations={message.citations} />
            ) : (
              <p>{message.content}</p>
            )}
          </li>
        ))}
        {messages.length === 0 && <li className="text-sm text-zinc-500">No questions yet.</li>}
      </ul>

      <form onSubmit={handleAsk} className="flex flex-col gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your sources"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          required
        />
        <button
          type="submit"
          disabled={asking}
          className="self-start rounded-full bg-black px-5 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {asking ? 'Asking…' : 'Ask'}
        </button>
        {askError && <p className="text-sm text-red-600">{askError}</p>}
      </form>
    </section>
  );

  const studioPanel = (
    <section className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-medium">Studio</h2>
      <p className="text-sm text-zinc-500">Studio output will be saved here.</p>
    </section>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceHeader notebookId={notebookId} title={notebookTitle} onRenamed={setNotebookTitle} />
      <WorkspaceShell sources={sourcesPanel} chat={chatPanel} studio={studioPanel} />
    </div>
  );
}
