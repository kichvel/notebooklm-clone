'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2Icon, RefreshCwIcon, SendIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WelcomeState } from './welcome-state';
import { CitationDrawer, type Citation } from './citation-drawer';
import { FollowUpChips } from './follow-up-chips';
import { ConfigureChatDialog } from './configure-chat-dialog';
import { ThoughtsPanel } from './thoughts-panel';
import type { ChatSettings } from '@/lib/notebooks/chatSettings';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'refused' | 'failed';
  created_at: string;
  follow_up_questions: string[] | null;
  citations: Citation[];
  reasoning: string | null;
  introSource?: { title: string; filename: string | null } | null;
}

function AnswerText({
  content,
  citations,
  onOpenCitation,
}: {
  content: string;
  citations: Citation[];
  onOpenCitation: (citation: Citation) => void;
}) {
  const byLabel = new Map(citations.map((c) => [c.label, c]));
  const parts = content.split(/(\[\d+\])/g);

  return (
    <p className="whitespace-pre-wrap text-sm">
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        const citation = match ? byLabel.get(Number(match[1])) : undefined;
        if (!citation) return <span key={i}>{part}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpenCitation(citation)}
            className="mx-0.5 rounded bg-secondary px-1 font-medium text-secondary-foreground hover:bg-secondary/70"
          >
            {part}
          </button>
        );
      })}
    </p>
  );
}

export function ChatPanel({
  messages,
  question,
  onQuestionChange,
  onAsk,
  asking,
  askError,
  hasProcessingSources,
  onSelectFollowUp,
  sourceCount,
  chatSettings,
  onUpdateChatSettings,
  streaming,
  retryingMessageId,
  onRetry,
  pendingIntroTitles,
}: {
  messages: Message[];
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: (event: React.FormEvent) => void;
  asking: boolean;
  askError: string | null;
  hasProcessingSources: boolean;
  onSelectFollowUp: (question: string) => void;
  sourceCount: number;
  chatSettings: ChatSettings;
  onUpdateChatSettings: (settings: ChatSettings) => Promise<void>;
  streaming: { reasoning: string; answer: string; citations: Citation[] } | null;
  retryingMessageId: string | null;
  onRetry: (messageId: string) => void;
  pendingIntroTitles: string[];
}) {
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasPendingIntro = pendingIntroTitles.length > 0;
  const isBusyWithSources = hasProcessingSources || hasPendingIntro;

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, asking]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Chat</h2>
        <ConfigureChatDialog settings={chatSettings} onSave={onUpdateChatSettings} />
      </div>
      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        {messages.length === 0 && !asking ? (
          <WelcomeState isBusyWithSources={isBusyWithSources} />
        ) : (
          <ul className="flex flex-col gap-4 p-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`flex min-w-0 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' ? (
                  <div className="min-w-0 max-w-full">
                    {retryingMessageId === message.id ? (
                      <>
                        {streaming?.reasoning && (
                          <ThoughtsPanel text={streaming.reasoning} streaming />
                        )}
                        {streaming?.answer ? (
                          <AnswerText
                            content={streaming.answer}
                            citations={streaming.citations}
                            onOpenCitation={setOpenCitation}
                          />
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2Icon className="size-4 animate-spin" aria-hidden />
                            <span>Retrying…</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {message.introSource && (
                          <div className="mb-1">
                            <h4 className="text-sm font-semibold">{message.introSource.title}</h4>
                            {message.introSource.filename && (
                              <p className="text-xs text-muted-foreground">
                                {message.introSource.filename}
                              </p>
                            )}
                          </div>
                        )}
                        {message.reasoning && (
                          <ThoughtsPanel text={message.reasoning} streaming={false} />
                        )}
                        <AnswerText
                          content={message.content}
                          citations={message.citations}
                          onOpenCitation={setOpenCitation}
                        />
                        {message.status === 'failed' && (
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-sm text-destructive">
                              This answer didn&apos;t finish generating.
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={asking}
                              data-testid="retry-answer"
                              onClick={() => onRetry(message.id)}
                            >
                              <RefreshCwIcon className="size-3.5" aria-hidden />
                              Retry
                            </Button>
                          </div>
                        )}
                        {message.follow_up_questions && message.follow_up_questions.length > 0 && (
                          <FollowUpChips
                            questions={message.follow_up_questions}
                            onSelect={onSelectFollowUp}
                            disabled={asking}
                          />
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <p
                    data-testid="chat-bubble-user"
                    className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2 text-sm whitespace-pre-wrap text-secondary-foreground"
                  >
                    {message.content}
                  </p>
                )}
              </li>
            ))}
            {asking && !retryingMessageId && (
              <li className="flex justify-start" aria-live="polite">
                <div
                  data-testid="asking-indicator"
                  className="flex flex-col gap-2 text-sm text-muted-foreground"
                >
                  {streaming?.reasoning && <ThoughtsPanel text={streaming.reasoning} streaming />}
                  {streaming?.answer ? (
                    <AnswerText
                      content={streaming.answer}
                      citations={streaming.citations}
                      onOpenCitation={setOpenCitation}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Loader2Icon className="size-4 animate-spin" aria-hidden />
                      <span>Thinking…</span>
                    </div>
                  )}
                </div>
              </li>
            )}
            {hasProcessingSources && (
              <li className="flex justify-start" aria-live="polite">
                <div
                  data-testid="source-processing-indicator"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Loader2Icon className="size-4 animate-spin" aria-hidden />
                  <span>Processing new source…</span>
                </div>
              </li>
            )}
            {hasPendingIntro && (
              <li className="flex justify-start" aria-live="polite">
                <div
                  data-testid="intro-pending-indicator"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Loader2Icon className="size-4 animate-spin" aria-hidden />
                  <span>
                    Summarizing{' '}
                    {pendingIntroTitles.length === 1
                      ? pendingIntroTitles[0]
                      : `${pendingIntroTitles.length} new sources`}
                    …
                  </span>
                </div>
              </li>
            )}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border">
        <form onSubmit={onAsk} className="flex items-center gap-2 p-4">
          <Input
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            placeholder="Ask a question about your sources"
            disabled={asking || isBusyWithSources}
            required
          />
          <div className="flex flex-col items-center gap-1">
            <Button
              type="submit"
              size="icon"
              disabled={asking || isBusyWithSources}
              aria-label="Ask"
            >
              {asking || isBusyWithSources ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <SendIcon />
              )}
            </Button>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              Sources: {sourceCount}
            </span>
          </div>
        </form>
        {askError && <p className="px-4 pb-3 text-sm text-destructive">{askError}</p>}
      </div>

      <CitationDrawer
        citation={openCitation}
        onOpenChange={(open) => !open && setOpenCitation(null)}
      />
    </div>
  );
}
