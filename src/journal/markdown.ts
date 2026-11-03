import type { JournalAttachment } from './model';

export type JournalInline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'em' | 'delete' | 'code'; children: JournalInline[] }
  | { type: 'link'; href: string; children: JournalInline[] }
  | { type: 'image'; attachmentId: string; alt: string; caption?: string };

export type JournalBlock =
  | { type: 'paragraph' | 'quote'; children: JournalInline[] }
  | { type: 'heading'; level: number; children: JournalInline[] }
  | { type: 'list'; ordered: boolean; items: JournalInline[][] }
  | { type: 'code'; value: string }
  | { type: 'rule' };

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const inlineToken = /(!?)\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)|(`+)([^`\n]*?)\5|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g;

/** Accept only explicit web/contact URLs. Relative, executable, and data URLs stay text. */
export function safeJournalHref(value: string): string | null {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function inline(source: string, attachments: ReadonlyMap<string, JournalAttachment>): JournalInline[] {
  const result: JournalInline[] = [];
  const matcher = new RegExp(inlineToken.source, inlineToken.flags);
  const appendText = (value: string) => {
    if (!value) return;
    const prior = result.at(-1);
    if (prior?.type === 'text') prior.value += value;
    else result.push({ type: 'text', value });
  };
  let cursor = 0;
  for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
    if (match.index > cursor) appendText(source.slice(cursor, match.index));
    const token = match[0];
    if (match[1] === '!' || (match[1] === '' && match[2] !== undefined)) {
      const isImage = match[1] === '!';
      const label = match[2] ?? '';
      const target = match[3] ?? '';
      if (isImage && target.startsWith('attachment:')) {
        const attachmentId = target.slice('attachment:'.length);
        const attachment = idPattern.test(attachmentId) ? attachments.get(attachmentId) : undefined;
        if (attachment && (attachment.kind === 'image' || attachment.kind === 'chart-capture')) {
          result.push({ type: 'image', attachmentId, alt: label || attachment.alt || 'Journal attachment', ...(attachment.caption ? { caption: attachment.caption } : {}) });
        } else appendText(token);
      } else if (!isImage) {
        const href = safeJournalHref(target);
        if (href) result.push({ type: 'link', href, children: inline(label, attachments) });
        else appendText(token);
      } else appendText(token);
    } else if (match[5] !== undefined) {
      result.push({ type: 'code', children: [{ type: 'text', value: match[6] ?? '' }] });
    } else if (match[7] !== undefined || match[8] !== undefined) {
      result.push({ type: 'strong', children: inline(match[7] ?? match[8] ?? '', attachments) });
    } else if (match[9] !== undefined) {
      result.push({ type: 'delete', children: inline(match[9], attachments) });
    } else if (match[10] !== undefined || match[11] !== undefined) {
      result.push({ type: 'em', children: inline(match[10] ?? match[11] ?? '', attachments) });
    } else appendText(token);
    cursor = match.index + token.length;
  }
  if (cursor < source.length) appendText(source.slice(cursor));
  return result;
}

/** Small safe Markdown subset. Raw HTML is always text; image tokens resolve only to stored attachments. */
export function parseJournalMarkdown(source: string, attachments: readonly JournalAttachment[] = []): JournalBlock[] {
  const available = new Map(attachments.map(attachment => [attachment.id, attachment]));
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: JournalBlock[] = [];
  let paragraph: string[] = [];
  let fence: string[] | null = null;
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: inline(paragraph.join('\n'), available) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(item => inline(item, available)) });
    list = null;
  };

  for (const line of lines) {
    const marker = /^\s*(```+|~~~+)\s*/.exec(line);
    if (marker) {
      flushParagraph(); flushList();
      if (fence) { blocks.push({ type: 'code', value: fence.join('\n') }); fence = null; }
      else fence = [];
      continue;
    }
    if (fence) { fence.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: 'heading', level: heading[1].length, children: inline(heading[2], available) }); continue; }
    const quote = /^\s*> ?(.*)$/.exec(line);
    if (quote) { flushParagraph(); flushList(); blocks.push({ type: 'quote', children: inline(quote[1], available) }); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushParagraph(); flushList(); blocks.push({ type: 'rule' }); continue; }
    const unordered = /^\s*[-+*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((unordered ?? ordered)![1]);
      continue;
    }
    flushList(); paragraph.push(line);
  }
  if (fence) blocks.push({ type: 'code', value: fence.join('\n') });
  flushParagraph(); flushList();
  return blocks;
}

function appendInline(target: HTMLElement, nodes: readonly JournalInline[], doc: Document) {
  for (const node of nodes) {
    if (node.type === 'text') { target.append(doc.createTextNode(node.value)); continue; }
    if (node.type === 'image') {
      const frame = doc.createElement('span'); frame.className = 'journal-md-image';
      const image = doc.createElement('img'); image.alt = node.alt; image.loading = 'lazy'; image.tabIndex = 0; image.dataset.attachmentId = node.attachmentId;
      frame.append(image);
      if (node.caption) { const caption = doc.createElement('small'); caption.className = 'journal-md-caption'; caption.textContent = node.caption; frame.append(caption); }
      target.append(frame); continue;
    }
    const tag = node.type === 'strong' ? 'strong' : node.type === 'em' ? 'em' : node.type === 'delete' ? 'del' : node.type === 'code' ? 'code' : 'a';
    const element = doc.createElement(tag);
    if (node.type === 'link') { element.setAttribute('href', node.href); element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); }
    appendInline(element, node.children, doc); target.append(element);
  }
}

/** Render without innerHTML. The caller may lazily resolve each `data-attachment-id` from local storage. */
export function renderJournalMarkdown(source: string, attachments: readonly JournalAttachment[] = [], doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const block of parseJournalMarkdown(source, attachments)) {
    if (block.type === 'rule') { fragment.append(doc.createElement('hr')); continue; }
    if (block.type === 'code') { const pre = doc.createElement('pre'), code = doc.createElement('code'); code.textContent = block.value; pre.append(code); fragment.append(pre); continue; }
    if (block.type === 'list') {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) { const li = doc.createElement('li'); appendInline(li, item, doc); list.append(li); }
      fragment.append(list); continue;
    }
    const tag = block.type === 'heading' ? `h${block.level}` : block.type === 'quote' ? 'blockquote' : 'p';
    const element = doc.createElement(tag); appendInline(element, block.children, doc); fragment.append(element);
  }
  return fragment;
}
