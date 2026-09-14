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
    const awaitingIntro =
      !hasActiveSource &&
      sources.some((source) => source.status === 'ready') &&
      messages.length === 0 &&
      notebookTitle === 'Untitled notebook';
    if (!hasActiveSource && !awaitingIntro) return;
    const interval = setInterval(() => {
      refreshSources();
      refreshNotebook();
      refreshMessages();
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, messages, notebookTitle]);

  async function postSource(input: RequestInit) {
    setError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: 'POST',
        ...input,
      });
      if (!response.ok) throw new Error('Failed to add source');
      const body = await response.json();
      if (Array.isArray(body?.skipped) && body.skipped.length > 0) {
        setError(
          `Some files were skipped: ${body.skipped.map((s: { filename: string; reason: string }) => `${s.filename} (${s.reason})`).join(', ')}`,
        );
      }
      await refreshSources();
    } catch (err) {
      setError('Something went wrong adding that source. Please try again.');
      throw err;
    }
  }

  async function handleAddFiles(files: FileList) {
    const formData = new FormData();
    for (const file of Array.from(files)) formData.append('files', file);
    await postSource({ body: formData });
  }

  async function handleAddWebsite(url: string) {
    setError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/sources/website`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) throw new Error('Failed to add website source');
      await refreshSources();
    } catch (err) {
      setError('Something went wrong adding that source. Please try again.');
      throw err;
    }
  }

  async function handleAddYoutube(url: string) {
    setError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/sources/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) throw new Error('Failed to add YouTube source');
      await refreshSources();
    } catch (err) {
      setError('Something went wrong adding that source. Please try again.');
      throw err;
    }
  }

  async function handleAddText(text: string) {
    await postSource({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
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

  async function submitQuestion(text: string) {
    if (asking) return;
    setAsking(true);
    setAskError(null);
    const optimisticId = `pending-${crypto.randomUUID()}`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: 'user',
        content: text,
        status: 'complete',
        created_at: new Date().toISOString(),
        follow_up_questions: null,
        citations: [],
      },
    ]);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, sourceIds: [...selectedSourceIds] }),
      });
      if (!response.ok) throw new Error('Failed to ask question');
      setQuestion('');
      await refreshMessages();
    } catch {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setAskError('Something went wrong asking that question. Please try again.');
    } finally {
      setAsking(false);
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    await submitQuestion(question);
  }

  function handleSelectFollowUp(text: string) {
    void submitQuestion(text);
  }

  const sourcesHeaderAction = (
    <>
      <AddSourceDialog
        onAddFiles={handleAddFiles}
        onAddWebsite={handleAddWebsite}
        onAddYoutube={handleAddYoutube}
        onAddText={handleAddText}
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </>
  );

  const sourcesPanel = (
    <SourceList
      sources={sources}
      selectedIds={selectedSourceIds}
      onSelectionChange={setSelectedSourceIds}
      onRetry={handleRetry}
      onDelete={handleDeleteSource}
    />
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
      onSelectFollowUp={handleSelectFollowUp}
      sourceCount={selectedSourceIds.size}
    />
  );

  const readySourceCount = sources.filter((s) => s.status === 'ready').length;
  const studioPanel = <StudioPanel readySourceCount={readySourceCount} />;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceHeader notebookId={notebookId} title={notebookTitle} onRenamed={setNotebookTitle} />
      <WorkspaceShell
        sources={sourcesPanel}
        sourcesHeaderAction={sourcesHeaderAction}
        chat={chatPanel}
        studio={studioPanel}
      />
    </div>
  );
}
