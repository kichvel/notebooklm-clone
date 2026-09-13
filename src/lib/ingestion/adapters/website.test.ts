// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { safeFetchHtml } from '../url-safety';
import { websiteAdapter } from './website';

vi.mock('../url-safety', () => ({ safeFetchHtml: vi.fn() }));

const ARTICLE_HTML = `
<!doctype html>
<html>
  <head><title>How Sourcebooks Work</title></head>
  <body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <header><h1>Site Name</h1></header>
    <article>
      <h1>How Sourcebooks Work</h1>
      <p>Sourcebooks let you upload documents and ask grounded questions about them.</p>
      <p>Every answer traces back to a specific passage in a specific source, so you can verify it yourself.</p>
      <p>This keeps the system honest: if there is no supporting passage, it refuses to answer rather than guessing.</p>
      <p>That refusal behavior is a deliberate design choice documented in the product's architecture decisions.</p>
    </article>
    <footer>Copyright 2026. All rights reserved. Privacy policy. Terms of service.</footer>
  </body>
</html>
`;

describe('websiteAdapter', () => {
  it('extracts the main article text and strips nav/footer boilerplate', async () => {
    vi.mocked(safeFetchHtml).mockResolvedValue(ARTICLE_HTML);

    const { blocks } = await websiteAdapter.parse(undefined as never, {
      sourceId: 'source-1',
      storagePath: null,
      originUrl: 'https://example.com/article',
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('Sourcebooks let you upload documents');
    expect(blocks[0].text).not.toContain('Copyright 2026');
    expect(blocks[0].text).not.toContain('Privacy policy');
    expect(blocks[0].section).toBe('How Sourcebooks Work');
  });

  it('throws a non-retriable error when no readable content is extracted', async () => {
    vi.mocked(safeFetchHtml).mockResolvedValue('<html><body><div id="app"></div></body></html>');

    await expect(
      websiteAdapter.parse(undefined as never, {
        sourceId: 'source-1',
        storagePath: null,
        originUrl: 'https://example.com/spa',
      }),
    ).rejects.toThrow(/could not extract readable content/i);
  });
});
