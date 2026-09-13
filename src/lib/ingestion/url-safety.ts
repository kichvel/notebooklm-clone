import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

class UnsupportedUrlError extends Error {}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('::ffff:')) return isPrivateIPv4(normalized.slice(7));
  return false;
}

async function assertPublicDestination(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsupportedUrlError(`Unsupported URL scheme: ${url.protocol}`);
  }

  const hostname = url.hostname;
  if (hostname === 'localhost') {
    throw new UnsupportedUrlError('Unsupported destination: localhost');
  }

  const ipVersion = isIP(hostname);
  const addresses = ipVersion
    ? [{ address: hostname, family: ipVersion }]
    : await lookup(hostname, { all: true });

  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) {
      throw new UnsupportedUrlError(`Unsupported destination: ${hostname} resolves to a private address`);
    }
  }
}

export async function safeFetchHtml(rawUrl: string): Promise<string> {
  let currentUrl = new URL(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await assertPublicDestination(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/html' },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new UnsupportedUrlError('Redirect with no Location header');
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new UnsupportedUrlError(`Fetch failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) {
      throw new UnsupportedUrlError(`Unsupported content type: ${contentType}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new UnsupportedUrlError('Empty response body');

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new UnsupportedUrlError('Response exceeded the size limit');
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
  }

  throw new UnsupportedUrlError('Too many redirects');
}
