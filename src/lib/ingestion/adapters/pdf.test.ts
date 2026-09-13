// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pdfAdapter } from './pdf';

function buildMinimalPdf(pageTexts: string[]): Uint8Array {
  const header = '%PDF-1.4\n';
  const pageCount = pageTexts.length;
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');
  const fontObjNum = 3 + pageCount;

  const objects: string[] = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 200 200] /Contents ${fontObjNum + 1 + i} 0 R >>`,
    );
  }
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  for (let i = 0; i < pageCount; i++) {
    const content = `BT /F1 24 Tf 10 100 Td (${pageTexts[i]}) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  const objOffsets: number[] = [];
  let body = '';
  objects.forEach((objBody, idx) => {
    const objNum = idx + 1;
    objOffsets[objNum] = header.length + body.length;
    body += `${objNum} 0 obj\n${objBody}\nendobj\n`;
  });

  const totalObjects = objects.length + 1;
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjects; i++) {
    xref += `${String(objOffsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const xrefOffset = header.length + body.length;
  const trailer = `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(header + body + xref + trailer);
}

function fakeSupabaseReturning(bytes: Uint8Array) {
  return {
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([Buffer.from(bytes)]), error: null }),
      }),
    },
  } as unknown as Parameters<typeof pdfAdapter.parse>[0];
}

describe('pdfAdapter', () => {
  it('produces one block per page with page numbers', async () => {
    const bytes = buildMinimalPdf(['Page one text', 'Page two text']);
    const { blocks } = await pdfAdapter.parse(fakeSupabaseReturning(bytes), {
      sourceId: 'source-1',
      storagePath: 'notebook/source-1/original.pdf',
      originUrl: null,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].page).toBe(1);
    expect(blocks[0].text).toContain('Page one text');
    expect(blocks[1].page).toBe(2);
    expect(blocks[1].text).toContain('Page two text');
  });

  it('throws a non-retriable error when the PDF has no extractable text', async () => {
    const bytes = buildMinimalPdf(['']);
    await expect(
      pdfAdapter.parse(fakeSupabaseReturning(bytes), {
        sourceId: 'source-1',
        storagePath: 'notebook/source-1/original.pdf',
        originUrl: null,
      }),
    ).rejects.toThrow(/no extractable text/i);
  });
});
