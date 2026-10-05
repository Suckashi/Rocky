// Markdown in and out: Rocky's documents are created from Markdown, and read back as Markdown.
import MarkdownIt from 'markdown-it';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { type: 'heading'; level: number; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'table'; rows: string[][] }
  | { type: 'code'; text: string };

type Token = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number];

function runsOf(inline: Token | undefined): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  for (const t of inline?.children ?? []) {
    if (t.type === 'strong_open') bold = true;
    else if (t.type === 'strong_close') bold = false;
    else if (t.type === 'em_open') italic = true;
    else if (t.type === 'em_close') italic = false;
    else if (t.type === 'text' && t.content)
      runs.push({
        text: t.content,
        ...(bold ? { bold } : {}),
        ...(italic ? { italic } : {}),
      });
    else if (t.type === 'code_inline')
      runs.push({ text: t.content, code: true });
    else if (t.type === 'softbreak' || t.type === 'hardbreak')
      runs.push({ text: '\n' });
  }
  return runs;
}

export const plain = (runs: Run[]) => runs.map((r) => r.text).join('');

export function parseMarkdown(markdown: string): Block[] {
  const tokens = new MarkdownIt().parse(markdown, {});
  const blocks: Block[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'heading_open') {
      blocks.push({
        type: 'heading',
        level: Number(t.tag.slice(1)),
        runs: runsOf(tokens[i + 1]),
      });
      i += 2;
    } else if (t.type === 'paragraph_open' && !t.hidden) {
      blocks.push({ type: 'paragraph', runs: runsOf(tokens[i + 1]) });
      i += 2;
    } else if (
      t.type === 'bullet_list_open' ||
      t.type === 'ordered_list_open'
    ) {
      const close = t.type.replace('_open', '_close');
      const items: Run[][] = [];
      let depth = 0;
      for (i++; i < tokens.length; i++) {
        const u = tokens[i]!;
        if (u.type === t.type) depth++;
        if (u.type === close) {
          if (depth === 0) break;
          depth--;
        }
        if (u.type === 'inline') items.push(runsOf(u));
      }
      blocks.push({
        type: 'list',
        ordered: t.type === 'ordered_list_open',
        items,
      });
    } else if (t.type === 'table_open') {
      const rows: string[][] = [];
      let row: string[] = [];
      for (i++; i < tokens.length && tokens[i]!.type !== 'table_close'; i++) {
        const u = tokens[i]!;
        if (u.type === 'tr_open') row = [];
        else if (u.type === 'inline') row.push(u.content);
        else if (u.type === 'tr_close') rows.push(row);
      }
      blocks.push({ type: 'table', rows });
    } else if (t.type === 'fence' || t.type === 'code_block') {
      blocks.push({ type: 'code', text: t.content.replace(/\n$/, '') });
    }
  }
  return blocks;
}

export function markdownToHtml(markdown: string, title = ''): string {
  const body = new MarkdownIt().render(markdown);
  const escaped = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<title>${escaped}</title>\n</head>\n<body>\n${body}</body>\n</html>\n`;
}

const cellText = (s: string) =>
  s
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

export function table(rows: string[][]): string {
  const [head = [], ...body] = rows;
  const width = Math.max(...rows.map((r) => r.length), 1);
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const line = (r: string[]) => `| ${pad(r).map(cellText).join(' | ')} |`;
  return [line(head), line(Array(width).fill('---')), ...body.map(line)].join(
    '\n',
  );
}

/** Simple HTML (mammoth's output) to Markdown, keeping headings, emphasis, lists and tables. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(
    `<root>${html}</root>`,
    'text/html',
  );
  const inline = (node: Node): string => {
    if (node.nodeType === 3)
      return (node.textContent ?? '').replace(/\s+/g, ' ');
    const el = node as Element;
    const inner = Array.from(el.childNodes ?? [])
      .map(inline)
      .join('');
    switch (el.tagName?.toLowerCase()) {
      case 'strong':
      case 'b':
        return inner.trim() ? `**${inner}**` : inner;
      case 'em':
      case 'i':
        return inner.trim() ? `*${inner}*` : inner;
      case 'br':
        return '\n';
      case 'a':
        return el.getAttribute('href')
          ? `[${inner}](${el.getAttribute('href')})`
          : inner;
      default:
        return inner;
    }
  };
  const blocks: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes ?? [])) {
      const el = child as Element;
      const tag = el.tagName?.toLowerCase();
      if (!tag) {
        const text = (child.textContent ?? '').trim();
        if (text) blocks.push(text);
        continue;
      }
      if (/^h[1-6]$/.test(tag))
        blocks.push(`${'#'.repeat(Number(tag[1]))} ${inline(el).trim()}`);
      else if (tag === 'p') {
        const text = inline(el).trim();
        if (text) blocks.push(text);
      } else if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(el.childNodes ?? []).filter(
          (n) => (n as Element).tagName?.toLowerCase() === 'li',
        );
        blocks.push(
          items
            .map(
              (li, n) =>
                `${tag === 'ol' ? `${n + 1}.` : '-'} ${inline(li).trim()}`,
            )
            .join('\n'),
        );
      } else if (tag === 'table') {
        const rows = Array.from(el.getElementsByTagName('tr')).map((tr) =>
          Array.from(tr.childNodes ?? [])
            .filter((c) =>
              ['td', 'th'].includes(
                (c as Element).tagName?.toLowerCase() ?? '',
              ),
            )
            .map((c) => inline(c).trim()),
        );
        if (rows.length) blocks.push(table(rows));
      } else walk(el);
    }
  };
  walk(doc.documentElement!);
  return blocks.join('\n\n');
}
