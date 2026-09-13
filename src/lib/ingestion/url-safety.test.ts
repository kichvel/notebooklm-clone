// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { safeFetchHtml } from './url-safety';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

function fakeResponse({
  status = 200,
  contentType = 'text/html',
  bodyChunks = [new TextEncoder().encode('<html></html>')],
  location,
}: {
  status?: number;
  contentType?: string;
  bodyChunks?: Uint8Array[];
  location?: string;
} = {}) {
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return contentType;
        if (name === 'location') return location ?? null;
        return null;
      },
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (index < bodyChunks.length) {
            return { done: false, value: bodyChunks[index++] };
          }
          return { done: true, value: undefined };
        },
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

describe('safeFetchHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(lookup).mockReset();
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(safeFetchHtml('ftp://example.com')).rejects.toThrow(/unsupported/i);
  });

  it('rejects loopback/link-local literal IP destinations without a network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(safeFetchHtml('http://127.0.0.1/secret')).rejects.toThrow(/unsupported/i);
    await expect(safeFetchHtml('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /unsupported/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(safeFetchHtml('http://internal.example.com')).rejects.toThrow(/unsupported/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a redirect and re-validates the new destination', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 302, location: 'http://example.com/final' }))
      .mockResolvedValueOnce(fakeResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const html = await safeFetchHtml('http://example.com/start');
    expect(html).toContain('<html>');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('enforces a response size limit', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const hugeChunk = new Uint8Array(6 * 1024 * 1024);
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse({ bodyChunks: [hugeChunk] }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(safeFetchHtml('http://example.com/huge')).rejects.toThrow(/too large|size limit/i);
  });

  it('rejects a non-HTML content type', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ contentType: 'application/pdf' })));

    await expect(safeFetchHtml('http://example.com/file.pdf')).rejects.toThrow(/unsupported content type/i);
  });
});
