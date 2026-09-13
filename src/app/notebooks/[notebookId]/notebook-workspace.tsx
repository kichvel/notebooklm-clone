'use client';

import { useEffect, useRef, useState } from 'react';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { SourceList } from '@/components/sources/source-list';
import { AddSourceDialog } from '@/components/sources/add-source-dialog';
import type { SourceSummary as Source } from '@/components/sources/source-item';
import { ChatPanel, type Message } from '@/components/chat/chat-panel';
import { StudioPanel } from '@/components/studio/studio-panel';

const ACTIVE_STATUSES = new Set(['uploaded', 'processing']);

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
    const response = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}/retry`, {
      method: 'POST',
    });
    if (response.ok) await refreshSources();
  }

  async function handleDeleteSource(sourceId: string) {
    const response = await fetch(`/api/notebooks/${notebookId}/sources/${sourceId}`, {
      method: 'DELETE',
    });
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

  const hasProcessingSources = sources.some((s) => ACTIVE_STATUSES.has(s.status));

  const chatPanel = (
    <ChatPanel
      messages={messages}
      question={question}
      onQuestionChange={setQuestion}
      onAsk={handleAsk}
      asking={asking}
      askError={askError}
      hasProcessingSources={hasProcessingSources}
    />
  );

  const readySourceCount = sources.filter((s) => s.status === 'ready').length;
  const studioPanel = <StudioPanel readySourceCount={readySourceCount} />;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceHeader notebookId={notebookId} title={notebookTitle} onRenamed={setNotebookTitle} />
      <WorkspaceShell sources={sourcesPanel} chat={chatPanel} studio={studioPanel} />
    </div>
  );
}
