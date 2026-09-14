export function ThoughtsPanel({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text) return null;
  return (
    <details
      className="mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
      open={streaming}
    >
      <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
        Thoughts
      </summary>
      <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{text}</p>
    </details>
  );
}
