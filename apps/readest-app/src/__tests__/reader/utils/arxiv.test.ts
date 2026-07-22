import { describe, expect, it } from 'vitest';

import { getArxivPdfUrl } from '@/app/reader/utils/arxiv';

describe('getArxivPdfUrl', () => {
  it('converts modern and versioned abstract URLs to PDF URLs', () => {
    expect(getArxivPdfUrl('https://arxiv.org/abs/1706.03762')).toBe(
      'https://arxiv.org/pdf/1706.03762.pdf',
    );
    expect(getArxivPdfUrl('https://arxiv.org/abs/1706.03762v7')).toBe(
      'https://arxiv.org/pdf/1706.03762v7.pdf',
    );
  });

  it('normalizes legacy IDs and existing PDF URLs', () => {
    expect(getArxivPdfUrl('http://export.arxiv.org/abs/hep-th/9901001')).toBe(
      'https://arxiv.org/pdf/hep-th/9901001.pdf',
    );
    expect(getArxivPdfUrl('https://arxiv.org/pdf/1706.03762.pdf?download=1')).toBe(
      'https://arxiv.org/pdf/1706.03762.pdf',
    );
  });

  it('rejects unrelated hosts, routes, and malformed IDs', () => {
    expect(getArxivPdfUrl('https://example.com/abs/1706.03762')).toBeNull();
    expect(getArxivPdfUrl('https://arxiv.org/search/?query=transformer')).toBeNull();
    expect(getArxivPdfUrl('javascript:alert(1)')).toBeNull();
  });
});
