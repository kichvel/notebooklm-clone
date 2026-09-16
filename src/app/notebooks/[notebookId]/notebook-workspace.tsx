'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { SourceList } from '@/components/sources/source-list';
import { AddSourceDialog } from '@/components/sources/add-source-dialog';
import type { SourceSummary as Source } from '@/components/sources/source-item';
import { ChatPanel, type Message } from '@/components/chat/chat-panel';
import type { Citation } from '@/components/chat/citation-drawer';
import { StudioPanel } from '@/components/studio/studio-panel';
import type { ChatSettings } from '@/lib/notebooks/chatSettings';
import type { AskQuestionEvent } from '@/lib/generation';

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
  const [streaming, setStreaming] = useState<{
    reasoning: string;
    answer: string;
    citations: Citation[];
  } | null>(null);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    chatStyle: 'default',
    chatCustomStyle: null,
    chatAnswerLength: 'default',
  });

  async function refreshNotebook() {
    const response = await fetch(`/api/notebooks/${notebookId}`);
    if (!response.ok) return;
    const notebook = await response.json();
    setNotebookTitle(notebook.title);
    setChatSettings({
      chatStyle: notebook.chat_style ?? 'default',
      chatCustomStyle: notebook.chat_custom_style ?? null,
      chatAnswerLength: notebook.chat_answer_length ?? 'default',
    });
  }

  async function handleUpdateChatSettings(next: ChatSettings) {
    const response = await fetch(`/api/notebooks/${notebookId}/chat-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!response.ok) throw new Error('Failed to update chat settings');
    setChatSettings(next);
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
    const hasPendingIntro = sources.some(
      (source) => source.status === 'ready' && !source.intro_generated_at,
    );
    if (!hasActiveSource && !hasPendingIntro) return;
    const interval = setInterval(() => {
      refreshSources();
      refreshNotebook();
      refreshMessages();
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  async function postSource(
    input: RequestInit,
    extraSkips: { filename: string; reason: string }[] = [],
  ) {
    setError(null);
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: 'POST',
        ...input,
      });
      if (!response.ok) throw new Error('Failed to add source');
      const body = await response.json();
      const skipped = [...extraSkips, ...(Array.isArray(body?.skipped) ? body.skipped : [])];
      if (skipped.length > 0) {
        setError(
          `Some files were skipped: ${skipped.map((s: { filename: string; reason: string }) => `${s.filename} (${s.reason})`).join(', ')}`,
        );
      }
      await refreshSources();
    } catch (err) {
      setError('Something went wrong adding that source. Please try again.');
      throw err;
    }
  }

  async function handleAddFiles(files: FileList) {
    const supabase = createClient();
    const registrations: { id: string; filename: string }[] = [];
    const uploadSkips: { filename: string; reason: string }[] = [];

    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const { error } = await supabase.storage
        .from('sources')
        .upload(`${notebookId}/${id}/original.${ext}`, file);
      if (error) {
        uploadSkips.push({ filename: file.name, reason: 'Upload failed' });
      } else {
        registrations.push({ id, filename: file.name });
      }
    }

    if (registrations.length === 0) {
      setError(
        `Some files were skipped: ${uploadSkips.map((s) => `${s.filename} (${s.reason})`).join(', ')}`,
      );
      return;
    }

    await postSource(
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: registrations }),
      },
      uploadSkips,
    );
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

  async function handleAddText(text: string) {
    await postSource({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }

  async function handleRetrySource(sourceId: string) {
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

  async function consumeAnswerStream(
    response: Response,
    onDone?: () => void | Promise<void>,
  ): Promise<{ sawError: boolean; errorMessage?: string }> {
    if (!response.body) throw new Error('Failed to generate an answer');
    let sawError = false;
    let errorMessage: string | undefined;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line) as AskQuestionEvent;
        if (event.type === 'passages') {
          setStreaming((current) => current && { ...current, citations: event.citations });
        } else if (event.type === 'reasoning_delta') {
          setStreaming(
            (current) => current && { ...current, reasoning: current.reasoning + event.text },
          );
        } else if (event.type === 'answer_delta') {
          setStreaming((current) => current && { ...current, answer: current.answer + event.text });
        } else if (event.type === 'done') {
          // The answer itself is fully validated and persisted here; follow-up question
          // suggestions are still generating in the background and arrive as a trailing
          // event, so surface the finished answer to the user without waiting on those.
          await onDone?.();
        } else if (event.type === 'error') {
          sawError = true;
          errorMessage = event.message;
        }
      }
    }
    return { sawError, errorMessage };
  }

  async function submitQuestion(text: string) {
    if (asking) return;
    if (
      sources.some(
        (s) => ACTIVE_STATUSES.has(s.status) || (s.status === 'ready' && !s.intro_generated_at),
      )
    )
      return;
    setAsking(true);
    setAskError(null);
    setStreaming({ reasoning: '', answer: '', citations: [] });
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
        reasoning: null,
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
      const { sawError, errorMessage } = await consumeAnswerStream(response, async () => {
        await refreshMessages();
        setAsking(false);
        setStreaming(null);
      });
      if (sawError) throw new Error(errorMessage ?? 'Failed to generate an answer');
      setQuestion('');
      await refreshMessages();
    } catch (err) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      // The question and a 'failed' assistant message (with its own retry affordance) are
      // already persisted server-side even when generation errors out — refresh so they
      // become visible instead of the question silently disappearing from the transcript.
      await refreshMessages();
      setAskError(
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong asking that question. Please try again.',
      );
    } finally {
      setAsking(false);
      setStreaming(null);
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    await submitQuestion(question);
  }

  function handleSelectFollowUp(text: string) {
    void submitQuestion(text);
  }

  async function handleRetryAnswer(messageId: string) {
    if (asking) return;
    setAsking(true);
    setAskError(null);
    setRetryingMessageId(messageId);
    setStreaming({ reasoning: '', answer: '', citations: [] });
    try {
      const response = await fetch(`/api/notebooks/${notebookId}/messages/${messageId}/retry`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to retry answer');
      const { sawError, errorMessage } = await consumeAnswerStream(response, async () => {
        await refreshMessages();
        setAsking(false);
        setStreaming(null);
        setRetryingMessageId(null);
      });
      if (sawError) throw new Error(errorMessage ?? 'Failed to generate an answer');
    } catch (err) {
      setAskError(
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong retrying that answer. Please try again.',
      );
    } finally {
      await refreshMessages();
      setAsking(false);
      setStreaming(null);
      setRetryingMessageId(null);
    }
  }

  const sourcesHeaderAction = (
    <>
      <AddSourceDialog
        onAddFiles={handleAddFiles}
        onAddWebsite={handleAddWebsite}
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
      onRetry={handleRetrySource}
      onDelete={handleDeleteSource}
    />
  );

  const hasProcessingSources = sources.some((s) => ACTIVE_STATUSES.has(s.status));
  const pendingIntroTitles = sources
    .filter((s) => s.status === 'ready' && !s.intro_generated_at)
    .map((s) => s.title);

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
      chatSettings={chatSettings}
      onUpdateChatSettings={handleUpdateChatSettings}
      streaming={streaming}
      retryingMessageId={retryingMessageId}
      onRetry={handleRetryAnswer}
      pendingIntroTitles={pendingIntroTitles}
    />
  );

  const readySourceCount = sources.filter((s) => s.status === 'ready').length;
  const studioPanel = (
    <StudioPanel
      notebookId={notebookId}
      readySourceCount={readySourceCount}
      selectedSourceIds={selectedSourceIds}
    />
  );

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
