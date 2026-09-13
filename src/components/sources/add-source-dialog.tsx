'use client';

import { useRef, useState } from 'react';
import { ClipboardIcon, LinkIcon, PlusIcon, UploadIcon, VideoIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Mode = 'files' | 'website' | 'youtube' | 'text';

const MODES: { id: Mode; label: string; icon: typeof UploadIcon }[] = [
  { id: 'files', label: 'Upload files', icon: UploadIcon },
  { id: 'website', label: 'Website', icon: LinkIcon },
  { id: 'youtube', label: 'YouTube', icon: VideoIcon },
  { id: 'text', label: 'Copied text', icon: ClipboardIcon },
];

export interface AddSourceDialogProps {
  onAddFiles: (files: FileList) => Promise<void>;
  onAddWebsite: (url: string) => Promise<void>;
  onAddYoutube: (url: string) => Promise<void>;
  onAddText: (text: string) => Promise<void>;
}

export function AddSourceDialog({
  onAddFiles,
  onAddWebsite,
  onAddYoutube,
  onAddText,
}: AddSourceDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('files');
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFiles(null);
    setUrl('');
    setText('');
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'files') {
        if (!files || files.length === 0) throw new Error('Select at least one file');
        await onAddFiles(files);
      } else if (mode === 'website') {
        if (!url) throw new Error('Enter a URL');
        await onAddWebsite(url);
      } else if (mode === 'youtube') {
        if (!url) throw new Error('Enter a URL');
        await onAddYoutube(url);
      } else {
        if (!text) throw new Error('Paste some text');
        await onAddText(text);
      }
      setOpen(false);
      reset();
    } catch {
      setError('Something went wrong adding that source. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) setFiles(event.dataTransfer.files);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button type="button" className="w-full" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add sources
      </Button>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Add source</DialogTitle>
          </DialogHeader>

          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
            {MODES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                type="button"
                variant={mode === id ? 'default' : 'outline'}
                size="sm"
                className="rounded-full"
                onClick={() => setMode(id)}
              >
                <Icon />
                {label}
              </Button>
            ))}
          </div>

          {mode === 'files' && (
            <div
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground',
                dragActive && 'border-primary bg-muted',
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <p>or drop your files</p>
              <p className="text-xs">pdf, docx, markdown, audio</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.md,.mp3,.wav,.m4a,.webm,.ogg"
                className="hidden"
                onChange={(event) => setFiles(event.target.files)}
              />
              {files && files.length > 0 && (
                <ul className="w-full text-left text-xs text-foreground">
                  {Array.from(files).map((file) => (
                    <li key={file.name}>{file.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mode === 'website' && (
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste a website URL"
              type="url"
              required
            />
          )}

          {mode === 'youtube' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Only YouTube videos with captions/transcripts available can be added as a source.
              </p>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Paste a YouTube link"
                type="url"
                required
              />
            </div>
          )}

          {mode === 'text' && (
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste text here"
              rows={8}
              required
            />
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add source'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
