// Any of the six formats as Markdown, for the model to read and for diffs in the UI.
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import type { Format } from './formats.ts';
import { htmlToMarkdown, table } from './markdown.ts';
import { openPackage, readPart } from './ooxml.ts';
import { decodeText } from './text.ts';

/**
 * pdf.js needs the CJK CMaps as a plain directory path ending in "/" (ADR 0005, finding 1);
 * without them, text in non-embedded Chinese fonts reads as an empty string.
 */
const cMapDir = (() => {
  const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
  return `${join(dirname(pkg), 'cmaps').split(sep).join('/')}/`;
})();

export async function pdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js transfers the buffer it is given, so it gets a copy.
  const doc = await getDocumentProxy(bytes.slice(), {
    cMapUrl: cMapDir,
    cMapPacked: true,
  });
  const { text } = await extractText(doc, { mergePages: false });
  return text
    .map((page, i) => `## Page ${i + 1}\n\n${page.trim()}`)
    .join('\n\n');
}

export async function loadWorkbook(
  bytes: Uint8Array,
): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return book;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'formula' in value) {
    // Rocky writes formulas without cached results (Excel recalculates on open).
    return value.result === undefined || value.result === null
      ? `=${value.formula}`
      : String(value.result);
  }
  if (typeof value === 'object' && 'richText' in value)
    return value.richText.map((part) => part.text).join('');
  if (typeof value === 'object' && 'text' in value) return String(value.text);
  return String(value);
}

export function workbookToMarkdown(book: ExcelJS.Workbook): string {
  return book.worksheets
    .map((sheet) => {
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        for (let c = 1; c <= sheet.columnCount; c++)
          cells.push(cellText(row.getCell(c).value));
        rows.push(cells);
      });
      return `## ${sheet.name}\n\n${rows.length ? table(rows) : '(empty)'}`;
    })
    .join('\n\n');
}

/** Slide parts in presentation order (zip entries can outlive their slide, ADR 0005 finding 4). */
export async function slidePaths(bytes: Uint8Array): Promise<string[]> {
  const zip = await openPackage(bytes);
  const pres = await readPart(zip, 'ppt/presentation.xml');
  const rels = await readPart(zip, 'ppt/_rels/presentation.xml.rels');
  const target = new Map(
    Array.from(rels.getElementsByTagName('Relationship')).map((r) => [
      r.getAttribute('Id'),
      `ppt/${(r.getAttribute('Target') ?? '').replace(/^\/?ppt\//, '')}`,
    ]),
  );
  return Array.from(pres.getElementsByTagName('p:sldId')).map((id) => {
    const path = target.get(id.getAttribute('r:id'));
    if (!path) throw new Error('slide relationship missing');
    return path;
  });
}

async function pptxText(bytes: Uint8Array): Promise<string> {
  const zip = await openPackage(bytes);
  const out: string[] = [];
  for (const [index, path] of (await slidePaths(bytes)).entries()) {
    const doc = await readPart(zip, path);
    const lines = Array.from(doc.getElementsByTagName('a:p'))
      .map((p) =>
        Array.from(p.getElementsByTagName('a:t'))
          .map((t) => t.textContent ?? '')
          .join(''),
      )
      .filter(Boolean);
    out.push(`## Slide ${index + 1}\n\n${lines.join('\n\n')}`);
  }
  return out.join('\n\n');
}

export async function toMarkdown(
  bytes: Uint8Array,
  format: Format,
): Promise<string> {
  switch (format) {
    case 'pdf':
      return pdfText(bytes);
    case 'docx': {
      // mammoth's Markdown output drops tables (ADR 0005 finding 3): go through HTML.
      const { value } = await mammoth.convertToHtml({
        buffer: Buffer.from(bytes),
      });
      return htmlToMarkdown(value);
    }
    case 'xlsx':
      return workbookToMarkdown(await loadWorkbook(bytes));
    case 'pptx':
      return pptxText(bytes);
    case 'md':
    case 'html':
      return decodeText(bytes).text;
  }
}
