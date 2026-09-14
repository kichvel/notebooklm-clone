'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MAX_CUSTOM_STYLE_LENGTH,
  type ChatAnswerLength,
  type ChatSettings,
  type ChatStyle,
} from '@/lib/notebooks/chatSettings';

const STYLE_OPTIONS: { id: ChatStyle; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'custom', label: 'Custom' },
];

const LENGTH_OPTIONS: { id: ChatAnswerLength; label: string }[] = [
  { id: 'shorter', label: 'Shorter' },
  { id: 'default', label: 'Default' },
  { id: 'longer', label: 'Longer' },
];

export function ConfigureChatDialog({
  settings,
  onSave,
}: {
  settings: ChatSettings;
  onSave: (settings: ChatSettings) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [chatStyle, setChatStyle] = useState<ChatStyle>(settings.chatStyle);
  const [chatCustomStyle, setChatCustomStyle] = useState(settings.chatCustomStyle ?? '');
  const [chatAnswerLength, setChatAnswerLength] = useState<ChatAnswerLength>(settings.chatAnswerLength);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setChatStyle(settings.chatStyle);
      setChatCustomStyle(settings.chatCustomStyle ?? '');
      setChatAnswerLength(settings.chatAnswerLength);
      setError(null);
    }
  }

  const canSave = chatStyle === 'default' || chatCustomStyle.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        chatStyle,
        chatCustomStyle: chatStyle === 'custom' ? chatCustomStyle : null,
        chatAnswerLength,
      });
      setOpen(false);
    } catch {
      setError('Something went wrong saving your settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Configure chat"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal />
      </Button>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Configure Chat</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Define your conversational goal, style, or role</p>
            <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
              {STYLE_OPTIONS.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  variant={chatStyle === id ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setChatStyle(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {chatStyle === 'custom' && (
              <div className="flex flex-col gap-1">
                <Textarea
                  value={chatCustomStyle}
                  onChange={(event) =>
                    setChatCustomStyle(event.target.value.slice(0, MAX_CUSTOM_STYLE_LENGTH))
                  }
                  placeholder='Examples: "respond at a PhD student level", "pretend to be a role-playing game host"'
                  rows={4}
                  required
                />
                <span className="text-xs text-muted-foreground">
                  {chatCustomStyle.length} / {MAX_CUSTOM_STYLE_LENGTH}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Choose your response length</p>
            <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
              {LENGTH_OPTIONS.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  variant={chatAnswerLength === id ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setChatAnswerLength(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={saving || !canSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
