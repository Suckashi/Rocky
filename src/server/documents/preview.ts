// Layout previews: what a document looks like, not only its text. Every format becomes one
// self-contained HTML page the UI shows in a sandboxed iframe (no scripts, no network):
// PDF pages as images (pdf.js on @napi-rs/canvas), Word through mammoth, Excel as styled
// tables, PowerPoint as slides with positioned text boxes and pictures.
import type { Element } from '@xmldom/xmldom';
import type ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { extname } from 'node:path';
import { formatOf, type Format } from './formats.ts';
import { markdownToHtml } from './markdown.ts';
import { openPackage, readPart } from './ooxml.ts';
import { cellText, cMapDir, loadWorkbook, slidePaths } from './read.ts';
import { decodeText } from './text.ts';

export interface Preview {
  html: string;
  /** Only the first pages, slides or rows are shown. */
  truncated: boolean;
}

export const PREVIEW_PAGES = 10;
const SHEET_ROWS = 200;
const SHEET_COLUMNS = 40;
const PDF_WIDTH = 1000;

// The page itself forbids every load except inline images and styles, links open nothing
// (no popups in the sandbox) and a meta refresh cannot navigate away.
const HEAD = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank">`;

const STYLE = `<style>
body{margin:0;padding:16px;background:#e9e7e2;font-family:system-ui,"Microsoft JhengHei","PingFang TC","Noto Sans CJK TC",sans-serif;color:#1b1b1b}
.page{background:#fff;max-width:820px;margin:0 auto 16px;padding:48px 56px;box-shadow:0 1px 4px rgba(0,0,0,.18);line-height:1.6}
.page table{border-collapse:collapse}.page td,.page th{border:1px solid #bbb;padding:4px 8px}.page td p,.page th p{margin:0}
.page img{max-width:100%}
.pdf{display:block;width:100%;max-width:820px;margin:0 auto 16px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.sheet{margin-bottom:24px}.sheet h2{font-size:14px;margin:0 0 6px}
.grid{border-collapse:collapse;background:#fff;font-size:13px}
.grid td,.grid th{border:1px solid #d4d4d4;padding:2px 6px;white-space:pre-wrap;vertical-align:bottom;min-width:48px}
.grid th{background:#f1f1f1;color:#555;font-weight:400;text-align:center}
.slide{position:relative;background:#fff;max-width:900px;margin:0 auto 16px;container-type:inline-size;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.slide .box{position:absolute;overflow:hidden;display:flex;flex-direction:column}
.slide .box p{margin:0;line-height:1.2}
.slide .box.table{overflow:visible}
.slide .box img{width:100%;height:100%;object-fit:contain}
.code{margin:0;background:#fff;padding:12px 0;font:13px/1.5 ui-monospace,Consolas,monospace;counter-reset:line;white-space:pre-wrap;word-break:break-all}
.code span{display:block;padding:0 12px 0 4.5em;text-indent:-3.5em}
.code span::before{counter-increment:line;content:counter(line);display:inline-block;width:3em;margin-right:.5em;text-align:right;color:#999}
.picture{display:block;max-width:100%;margin:0 auto;background:#fff}
.slide .no{position:absolute;right:8px;bottom:4px;font-size:11px;color:#999}
</style>`;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (body: string, extraHead = '') =>
  `<!doctype html><html><head>${HEAD}${STYLE}${extraHead}</head><body>${body}</body></html>`;

/** A user's own HTML file, kept as written but under the same restrictions. */
function ownHtml(text: string): string {
  const cleaned = text
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  return `<!doctype html>${HEAD}${cleaned}`;
}

async function pdfPreview(bytes: Uint8Array): Promise<Preview> {
  // pdf.js transfers the buffer it is given, so it gets a copy.
  const doc = await getDocumentProxy(bytes.slice(), {
    cMapUrl: cMapDir,
    cMapPacked: true,
  });
  const count = Math.min(doc.numPages, PREVIEW_PAGES);
  const images: string[] = [];
  for (let n = 1; n <= count; n++) {
    const { width } = (await doc.getPage(n)).getViewport({ scale: 1 });
    const url = await renderPageAsImage(doc, n, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: PDF_WIDTH / width,
      toDataURL: true,
    });
    images.push(`<img class="pdf" alt="${n}" src="${url}">`);
  }
  return { html: page(images.join('')), truncated: doc.numPages > count };
}

// --- Excel ---

const argb = (color: Partial<ExcelJS.Color> | undefined) =>
  color?.argb && /^[0-9a-f]{8}$/i.test(color.argb)
    ? `#${color.argb.slice(2)}`
    : undefined;

function columnName(n: number): string {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function address(a1: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(a1.replace(/\$/g, ''))!;
  const col = [...m[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  return { row: Number(m[2]), col };
}

function cellStyle(cell: ExcelJS.Cell): string {
  const css: string[] = [];
  const font = cell.font ?? {};
  if (font.bold) css.push('font-weight:700');
  if (font.italic) css.push('font-style:italic');
  if (font.underline) css.push('text-decoration:underline');
  if (font.size) css.push(`font-size:${font.size}pt`);
  const color = argb(font.color);
  if (color) css.push(`color:${color}`);
  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const bg = argb(fill.fgColor);
    if (bg) css.push(`background:${bg}`);
  }
  const align = cell.alignment?.horizontal;
  if (align === 'center' || align === 'right' || align === 'left')
    css.push(`text-align:${align}`);
  else if (typeof cell.value === 'number') css.push('text-align:right');
  if (cell.alignment?.wrapText) css.push('white-space:pre-wrap');
  return css.join(';');
}

async function xlsxPreview(bytes: Uint8Array): Promise<Preview> {
  const book = await loadWorkbook(bytes);
  let truncated = false;
  const sheets = book.worksheets.map((sheet) => {
    const rows = Math.min(sheet.rowCount, SHEET_ROWS);
    const cols = Math.min(sheet.columnCount, SHEET_COLUMNS);
    truncated ||= sheet.rowCount > rows || sheet.columnCount > cols;
    // Merged ranges: the top-left cell spans, the others are skipped.
    const spans = new Map<string, { rows: number; cols: number }>();
    const covered = new Set<string>();
    for (const range of (sheet.model as { merges?: string[] }).merges ?? []) {
      const [from, to] = range.split(':').map(address);
      if (!from || !to) continue;
      spans.set(`${from.row}:${from.col}`, {
        rows: to.row - from.row + 1,
        cols: to.col - from.col + 1,
      });
      for (let r = from.row; r <= to.row; r++)
        for (let c = from.col; c <= to.col; c++)
          if (r !== from.row || c !== from.col) covered.add(`${r}:${c}`);
    }
    const widths = Array.from({ length: cols }, (_, i) => {
      const w = sheet.getColumn(i + 1).width;
      return `<col style="width:${Math.round((w ?? 9) * 7 + 12)}px">`;
    });
    const head = `<tr><th></th>${Array.from({ length: cols }, (_, i) => `<th>${columnName(i + 1)}</th>`).join('')}</tr>`;
    const body: string[] = [];
    for (let r = 1; r <= rows; r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [`<th>${r}</th>`];
      for (let c = 1; c <= cols; c++) {
        if (covered.has(`${r}:${c}`)) continue;
        const cell = row.getCell(c);
        const span = spans.get(`${r}:${c}`);
        const attrs = span
          ? `${span.rows > 1 ? ` rowspan="${span.rows}"` : ''}${span.cols > 1 ? ` colspan="${span.cols}"` : ''}`
          : '';
        const style = cellStyle(cell);
        cells.push(
          `<td${attrs}${style ? ` style="${style}"` : ''}>${escape(cellText(cell.value))}</td>`,
        );
      }
      body.push(`<tr>${cells.join('')}</tr>`);
    }
    return `<section class="sheet"><h2>${escape(sheet.name)}</h2><table class="grid"><colgroup><col style="width:36px">${widths.join('')}</colgroup>${head}${body.join('')}</table></section>`;
  });
  return { html: page(sheets.join('')), truncated };
}

// --- PowerPoint ---

const EMU_PER_POINT = 12700;
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const children = (el: Element | null | undefined, name: string): Element[] =>
  el
    ? (Array.from(el.childNodes).filter(
        (n) => (n as Element).tagName === name,
      ) as Element[])
    : [];
const child = (el: Element | null | undefined, name: string) =>
  children(el, name)[0];
const first = (el: Element | null | undefined, name: string) =>
  (el?.getElementsByTagName(name)[0] as Element | undefined) ?? undefined;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function xfrm(spPr: Element | undefined): Box | undefined {
  const off = first(spPr, 'a:off');
  const ext = first(spPr, 'a:ext');
  if (!off || !ext) return undefined;
  return {
    x: Number(off.getAttribute('x')),
    y: Number(off.getAttribute('y')),
    w: Number(ext.getAttribute('cx')),
    h: Number(ext.getAttribute('cy')),
  };
}

/** Part paths a slide (or layout) refers to by relationship id, resolved to zip paths. */
async function relations(
  zip: Awaited<ReturnType<typeof openPackage>>,
  part: string,
): Promise<Map<string, string>> {
  const dir = part.slice(0, part.lastIndexOf('/'));
  const relsPath = `${dir}/_rels/${part.slice(dir.length + 1)}.rels`;
  if (!zip.file(relsPath)) return new Map();
  const rels = await readPart(zip, relsPath);
  return new Map(
    Array.from(rels.getElementsByTagName('Relationship')).map((r) => {
      const target = r.getAttribute('Target') ?? '';
      const parts = target.startsWith('/')
        ? target.slice(1).split('/')
        : [...dir.split('/'), ...target.split('/')];
      const out: string[] = [];
      for (const p of parts) {
        if (p === '..') out.pop();
        else if (p !== '.') out.push(p);
      }
      return [r.getAttribute('Id') ?? '', out.join('/')];
    }),
  );
}

const placeholderKey = (sp: Element) => {
  const ph = first(sp, 'p:ph');
  if (!ph) return undefined;
  return {
    type: ph.getAttribute('type') || 'body',
    idx: ph.getAttribute('idx') ?? '',
  };
};

/** Placeholder shapes keep their position in the layout or master unless the slide moves them. */
function findPlaceholder(
  docs: Element[],
  key: { type: string; idx: string },
): Box | undefined {
  for (const doc of docs) {
    const shapes = Array.from(doc.getElementsByTagName('p:sp'));
    const match =
      shapes.find((s) => key.idx && placeholderKey(s)?.idx === key.idx) ??
      shapes.find((s) => placeholderKey(s)?.type === key.type);
    const box = match && xfrm(child(match, 'p:spPr'));
    if (box) return box;
  }
  return undefined;
}

function paragraphs(txBody: Element | undefined, title: boolean): string {
  let number = 0;
  return children(txBody, 'a:p')
    .map((p) => {
      const pPr = child(p, 'a:pPr');
      const align = pPr?.getAttribute('algn');
      const size = (pr: Element | undefined) =>
        Number(pr?.getAttribute('sz') ?? 0) / 100 || (title ? 32 : 18);
      const runs = Array.from(p.childNodes)
        .filter((n): n is Element =>
          ['a:r', 'a:fld', 'a:br'].includes((n as Element).tagName),
        )
        .map((r) => {
          if (r.tagName === 'a:br') return '<br>';
          const pr = child(r, 'a:rPr');
          const css = [`font-size:calc(${size(pr)} * var(--pt))`];
          if (pr?.getAttribute('b') === '1') css.push('font-weight:700');
          if (pr?.getAttribute('i') === '1') css.push('font-style:italic');
          const color = first(first(pr, 'a:solidFill'), 'a:srgbClr');
          if (color) css.push(`color:#${color.getAttribute('val')}`);
          const text = child(r, 'a:t')?.textContent ?? '';
          return `<span style="${css.join(';')}">${escape(text)}</span>`;
        })
        .join('');
      // Bullets and numbering are paragraph properties, not text.
      const char = child(pPr, 'a:buChar')?.getAttribute('char');
      number = child(pPr, 'a:buAutoNum') ? number + 1 : 0;
      const bullet = char ? `${escape(char)} ` : number ? `${number}. ` : '';
      const textAlign =
        align === 'ctr' ? 'center' : align === 'r' ? 'right' : 'left';
      const indent = bullet ? ';padding-left:1.2em;text-indent:-1.2em' : '';
      return `<p style="text-align:${textAlign};font-size:calc(${size(first(p, 'a:rPr'))} * var(--pt))${indent}">${bullet}${runs || '&nbsp;'}</p>`;
    })
    .join('');
}

async function pptxPreview(bytes: Uint8Array): Promise<Preview> {
  const zip = await openPackage(bytes);
  const pres = await readPart(zip, 'ppt/presentation.xml');
  const size = pres.getElementsByTagName('p:sldSz')[0];
  const W = Number(size?.getAttribute('cx') ?? 12192000);
  const H = Number(size?.getAttribute('cy') ?? 6858000);
  const all = await slidePaths(bytes);
  const paths = all.slice(0, PREVIEW_PAGES);
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
  const slides: string[] = [];
  for (const [index, path] of paths.entries()) {
    const slide = await readPart(zip, path);
    const rels = await relations(zip, path);
    // The slide's layout and its master, for placeholder positions.
    const inherited: Element[] = [];
    const layoutPath = [...rels.values()].find((p) =>
      p.includes('slideLayouts/'),
    );
    if (layoutPath && zip.file(layoutPath)) {
      inherited.push((await readPart(zip, layoutPath)).documentElement!);
      const masterPath = [...(await relations(zip, layoutPath)).values()].find(
        (p) => p.includes('slideMasters/'),
      );
      if (masterPath && zip.file(masterPath))
        inherited.push((await readPart(zip, masterPath)).documentElement!);
    }
    const boxes: string[] = [];
    const tree = first(slide.documentElement!, 'p:spTree');
    const place = (box: Box, inner: string, extra = '', kind = '') =>
      boxes.push(
        `<div class="box${kind}" style="left:${pct(box.x, W)};top:${pct(box.y, H)};width:${pct(box.w, W)};height:${pct(box.h, H)}${extra}">${inner}</div>`,
      );
    for (const el of Array.from(tree?.getElementsByTagName('*') ?? [])) {
      if (el.tagName === 'p:sp') {
        const spPr = child(el, 'p:spPr');
        const key = placeholderKey(el);
        const box =
          xfrm(spPr) ?? (key ? findPlaceholder(inherited, key) : undefined);
        if (!box) continue;
        const fill = first(child(spPr, 'a:solidFill'), 'a:srgbClr');
        const title = key?.type === 'title' || key?.type === 'ctrTitle';
        const anchor = first(child(el, 'p:txBody'), 'a:bodyPr')?.getAttribute(
          'anchor',
        );
        place(
          box,
          paragraphs(child(el, 'p:txBody'), title),
          `${fill ? `;background:#${fill.getAttribute('val')}` : ''};justify-content:${anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : title ? 'center' : 'flex-start'}`,
        );
      } else if (el.tagName === 'p:pic') {
        const box = xfrm(child(el, 'p:spPr'));
        const id = first(el, 'a:blip')?.getAttribute('r:embed');
        const target = id ? rels.get(id) : undefined;
        const type = IMAGE_TYPES[target?.split('.').pop()?.toLowerCase() ?? ''];
        const file = target ? zip.file(target) : null;
        if (!box || !type || !file) continue;
        place(
          box,
          `<img alt="" src="data:${type};base64,${await file.async('base64')}">`,
        );
      } else if (el.tagName === 'p:graphicFrame') {
        const box = xfrm(child(el, 'p:xfrm') ?? undefined);
        const tbl = first(el, 'a:tbl');
        if (!box || !tbl) continue;
        const rows = children(tbl, 'a:tr')
          .map(
            (tr) =>
              `<tr>${children(tr, 'a:tc')
                .map(
                  (tc) =>
                    `<td style="border:1px solid #999;padding:2px 4px">${paragraphs(child(tc, 'a:txBody'), false)}</td>`,
                )
                .join('')}</tr>`,
          )
          .join('');
        place(
          box,
          `<table style="border-collapse:collapse;width:100%">${rows}</table>`,
          '',
          ' table',
        );
      }
    }
    slides.push(
      `<section class="slide" style="aspect-ratio:${W}/${H};--pt:calc(100cqw / ${W / EMU_PER_POINT})">${boxes.join('')}<span class="no">${index + 1}</span></section>`,
    );
  }
  return { html: page(slides.join('')), truncated: all.length > paths.length };
}

export async function previewDocument(
  bytes: Uint8Array,
  format: Format,
): Promise<Preview> {
  switch (format) {
    case 'pdf':
      return pdfPreview(bytes);
    case 'docx': {
      const { value } = await mammoth.convertToHtml({
        buffer: Buffer.from(bytes),
      });
      return {
        html: page(`<article class="page">${value}</article>`),
        truncated: false,
      };
    }
    case 'xlsx':
      return xlsxPreview(bytes);
    case 'pptx':
      return pptxPreview(bytes);
    case 'md': {
      const body = /<body>([\s\S]*)<\/body>/.exec(
        markdownToHtml(decodeText(bytes).text),
      )![1]!;
      return {
        html: page(`<article class="page">${body}</article>`),
        truncated: false,
      };
    }
    case 'html':
      return { html: ownHtml(decodeText(bytes).text), truncated: false };
  }
}

const PICTURES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const TEXT_LIMIT = 1024 * 1024;

/** Any project file: documents by format, pictures as images, other UTF-8 text with line numbers. */
export async function previewFile(
  bytes: Uint8Array,
  path: string,
): Promise<Preview | undefined> {
  const format = formatOf(path);
  if (format) return previewDocument(bytes, format);
  const picture = PICTURES[extname(path).slice(1).toLowerCase()];
  if (picture)
    return {
      html: page(
        `<img class="picture" alt="" src="data:${picture};base64,${Buffer.from(bytes).toString('base64')}">`,
      ),
      truncated: false,
    };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, TEXT_LIMIT),
    );
  } catch {
    return undefined;
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return {
    html: page(
      `<pre class="code">${lines.map((l) => `<span>${escape(l)}</span>`).join('')}</pre>`,
    ),
    truncated: bytes.length > TEXT_LIMIT,
  };
}
