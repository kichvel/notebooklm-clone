'use client';

import { useState } from 'react';
import { Loader2Icon, SendIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WelcomeState } from './welcome-state';
import { CitationDrawer, type Citation } from './citation-drawer';
import { FollowUpChips } from './follow-up-chips';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'refused' | 'failed';
  created_at: string;
  follow_up_questions: string[] | null;
  citations: Citation[];
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
}: {
  messages: Message[];
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: (event: React.FormEvent) => void;
  asking: boolean;
  askError: string | null;
  hasProcessingSources: boolean;
  onSelectFollowUp: (question: string) => void;
}) {
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !asking ? (
          <WelcomeState
            hasProcessingSources={hasProcessingSources}
            onSelectQuestion={onQuestionChange}
          />
        ) : (
          <ul className="flex flex-col gap-4 p-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' ? (
                  <div>
                    <AnswerText
                      content={message.content}
                      citations={message.citations}
                      onOpenCitation={setOpenCitation}
                    />
                    {message.follow_up_questions && message.follow_up_questions.length > 0 && (
                      <FollowUpChips
                        questions={message.follow_up_questions}
                        onSelect={onSelectFollowUp}
                        disabled={asking}
                      />
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
            {asking && (
              <li className="flex justify-start" aria-live="polite">
                <div
                  data-testid="asking-indicator"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Loader2Icon className="size-4 animate-spin" aria-hidden />
                  <span>Thinking…</span>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      <form onSubmit={onAsk} className="flex items-center gap-2 border-t border-border p-4">
        <Input
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder="Ask a question about your sources"
          disabled={asking}
          required
        />
        <Button type="submit" size="icon" disabled={asking} aria-label="Ask">
          {asking ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        </Button>
      </form>
      {askError && <p className="px-4 pb-3 text-sm text-destructive">{askError}</p>}

      <CitationDrawer
        citation={openCitation}
        onOpenChange={(open) => !open && setOpenCitation(null)}
      />
    </div>
  );
}
