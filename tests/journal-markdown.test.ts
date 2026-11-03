import { describe, expect, it } from 'vitest';
import { parseJournalMarkdown, safeJournalHref } from '../src/journal/markdown';
import type { JournalAttachment } from '../src/journal/model';

const image: JournalAttachment = { id: 'img-1', kind: 'image', assetId: 'asset-1', alt: 'Chart image' };

describe('journal Markdown safety', () => {
  it('keeps raw HTML and unsafe links as plain text', () => {
    const blocks = parseJournalMarkdown('<script>alert(1)</script> [run](javascript:alert(1))');
    expect(blocks).toEqual([{ type: 'paragraph', children: [
      { type: 'text', value: '<script>alert(1)</script> [run](javascript:alert(1))' },
    ] }]);
  });

  it('renders only known local attachment references as images', () => {
    const blocks = parseJournalMarkdown('![chart](attachment:img-1) ![remote](https://example.test/chart.png) ![missing](attachment:absent)', [image]);
    expect(blocks[0]).toEqual({ type: 'paragraph', children: [
      { type: 'image', attachmentId: 'img-1', alt: 'chart' },
      { type: 'text', value: ' ![remote](https://example.test/chart.png) ![missing](attachment:absent)' },
    ] });
  });

  it('keeps formatting and allows only explicit safe schemes', () => {
    expect(safeJournalHref('https://example.test/a')).toBe('https://example.test/a');
    expect(safeJournalHref('mailto:desk@example.test')).toBe('mailto:desk@example.test');
    expect(safeJournalHref('data:text/html,hi')).toBeNull();
    expect(safeJournalHref('/relative/path')).toBeNull();
    expect(parseJournalMarkdown('**strong** and `code`')).toEqual([{ type: 'paragraph', children: [
      { type: 'strong', children: [{ type: 'text', value: 'strong' }] },
      { type: 'text', value: ' and ' },
      { type: 'code', children: [{ type: 'text', value: 'code' }] },
    ] }]);
  });
});
