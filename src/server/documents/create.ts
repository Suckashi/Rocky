// New documents from Markdown. Office files use an East Asian font so Chinese renders the
// same on every machine; PDFs embed a subset of a CJK font.
import fontkit from '@pdf-lib/fontkit';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import pptxgen from 'pptxgenjs';
import { pdfFont } from './fonts.ts';
import type { Format } from './formats.ts';
import {
  markdownToHtml,
  parseMarkdown,
  plain,
  type Block,
  type Run,
} from './markdown.ts';
import { encodeText } from './text.ts';

const CJK_FONT = 'Microsoft JhengHei';
// pptxgenjs's types are CommonJS-shaped under NodeNext; at runtime the default export is the class.
const PptxGenJS = pptxgen as unknown as typeof pptxgen.default;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const textRuns = (runs: Run[]) =>
  runs.map(
    (r) =>
      new TextRun({
        text: r.text,
        ...(r.bold ? { bold: true } : {}),
        ...(r.italic ? { italics: true } : {}),
        ...(r.code ? { font: 'Consolas' } : {}),
      }),
  );

async function docx(blocks: Block[]): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  for (const b of blocks) {
    if (b.type === 'heading')
      children.push(
        new Paragraph({
          heading: HEADINGS[b.level - 1]!,
          children: textRuns(b.runs),
        }),
      );
    else if (b.type === 'paragraph')
      children.push(new Paragraph({ children: textRuns(b.runs) }));
    else if (b.type === 'list')
      b.items.forEach((item, i) =>
        children.push(
          b.ordered
            ? new Paragraph({
                children: [new TextRun(`${i + 1}. `), ...textRuns(item)],
              })
            : new Paragraph({ bullet: { level: 0 }, children: textRuns(item) }),
        ),
      );
    else if (b.type === 'code')
      for (const line of b.text.split('\n'))
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, font: 'Consolas' })],
          }),
        );
    else if (b.type === 'table')
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map(
            (row, r) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({ text: cell, bold: r === 0 }),
                          ],
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
  }
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: { ascii: 'Calibri', eastAsia: CJK_FONT } } },
      },
    },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function pptx(blocks: Block[]): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  // Each heading starts a slide; what follows it is that slide's body.
  const slides: { title: string; body: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === 'heading' && b.level <= 2)
      slides.push({ title: plain(b.runs), body: [] });
    else {
      if (slides.length === 0) slides.push({ title: '', body: [] });
      slides.at(-1)!.body.push(b);
    }
  }
  for (const s of slides) {
    const slide = pres.addSlide();
    if (s.title)
      slide.addText(s.title, {
        x: 0.6,
        y: 0.4,
        w: 12,
        h: 1,
        fontFace: CJK_FONT,
        fontSize: 30,
        bold: true,
      });
    // Text and tables stack top to bottom in Markdown order, about half an inch per line.
    let y = s.title ? 1.6 : 0.6;
    let lines: pptxgen.default.TextProps[] = [];
    const flush = () => {
      if (!lines.length) return;
      slide.addText(lines, {
        x: 0.6,
        y,
        w: 12,
        h: lines.length * 0.5,
        valign: 'top',
        fontFace: CJK_FONT,
        fontSize: 18,
      });
      y += lines.length * 0.5;
      lines = [];
    };
    for (const b of s.body) {
      if (b.type === 'table') {
        flush();
        slide.addTable(
          b.rows.map((row, r) =>
            row.map((text) => ({ text, options: { bold: r === 0 } })),
          ),
          { x: 0.6, y, w: 12, fontFace: CJK_FONT, fontSize: 14 },
        );
        y += 0.45 * b.rows.length + 0.3;
        continue;
      }
      const items =
        b.type === 'list'
          ? b.items.map(plain)
          : b.type === 'code'
            ? b.text.split('\n')
            : [plain(b.runs)];
      for (const text of items)
        lines.push({
          text,
          options: {
            breakLine: true,
            ...(b.type === 'list'
              ? { bullet: b.ordered ? { type: 'number' } : true }
              : {}),
            ...(b.type === 'heading' ? { bold: true } : {}),
          },
        });
    }
    flush();
  }
  return new Uint8Array(
    (await pres.write({ outputType: 'nodebuffer' })) as Buffer,
  );
}

function cellValue(text: string): ExcelJS.CellValue {
  const t = text.trim();
  if (t.startsWith('=') && t.length > 1) return { formula: t.slice(1) };
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export function setCell(cell: ExcelJS.Cell, text: string): void {
  cell.value = cellValue(text);
}

async function xlsx(blocks: Block[]): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  // Rocky cannot calculate formulas; Excel recalculates when the file opens.
  book.calcProperties.fullCalcOnLoad = true;
  let name = 'Sheet1';
  for (const b of blocks) {
    if (b.type === 'heading') name = plain(b.runs);
    if (b.type !== 'table') continue;
    const safe = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    const sheet = book.addWorksheet(
      book.getWorksheet(safe)
        ? `${safe.slice(0, 28)} ${book.worksheets.length + 1}`
        : safe,
    );
    b.rows.forEach((row, r) => {
      row.forEach((text, c) => setCell(sheet.getCell(r + 1, c + 1), text));
      if (r === 0) sheet.getRow(1).font = { bold: true, name: CJK_FONT };
    });
    sheet.columns.forEach((col) => (col.width = 16));
  }
  if (book.worksheets.length === 0) throw new Error('xlsx-needs-table');
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** Greedy line breaking by measured width: Chinese has no spaces, so any character may break. */
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (font.widthOfTextAtSize(line + ch, size) > width && line) {
        out.push(line);
        line = ch.trimStart();
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

async function pdf(blocks: Block[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(pdfFont(), { subset: true });
  const [W, H, M] = [595, 842, 56];
  let page = doc.addPage([W, H]);
  let y = H - M;
  /** Draws wrapped text; `bullet` puts a dot before the first line. */
  const draw = (
    text: string,
    size: number,
    indent = 0,
    gap = 6,
    bullet = false,
  ) => {
    for (const [i, line] of wrap(
      text,
      font,
      size,
      W - 2 * M - indent,
    ).entries()) {
      if (y - size < M) {
        page = doc.addPage([W, H]);
        y = H - M;
      }
      y -= size * 1.4;
      page.drawText(line, { x: M + indent, y, size, font });
      // A drawn dot, not "•": many CJK fonts have no bullet glyph (it would be an empty box).
      if (bullet && i === 0)
        page.drawCircle({
          x: M + indent - 8,
          y: y + size * 0.33,
          size: 1.8,
          color: rgb(0, 0, 0),
        });
    }
    y -= gap;
  };
  for (const b of blocks) {
    if (b.type === 'heading')
      draw(plain(b.runs), [22, 18, 15, 13, 12, 12][b.level - 1]!, 0, 10);
    else if (b.type === 'paragraph') draw(plain(b.runs), 12);
    else if (b.type === 'list')
      b.items.forEach((item, i) =>
        b.ordered
          ? draw(`${i + 1}. ${plain(item)}`, 12, 12, 2)
          : draw(plain(item), 12, 24, 2, true),
      );
    else if (b.type === 'code') draw(b.text, 10, 12);
    else if (b.type === 'table')
      for (const row of b.rows) draw(row.join('  |  '), 11, 0, 2);
  }
  return doc.save();
}

export async function fromMarkdown(
  markdown: string,
  format: Format,
  title = '',
): Promise<Uint8Array> {
  const blocks = parseMarkdown(markdown);
  switch (format) {
    case 'docx':
      return docx(blocks);
    case 'pptx':
      return pptx(blocks);
    case 'xlsx':
      return xlsx(blocks);
    case 'pdf':
      return pdf(blocks);
    case 'html':
      return encodeText({
        text: markdownToHtml(markdown, title),
        bom: false,
        eol: '\n',
      });
    case 'md':
      return encodeText({ text: markdown, bom: false, eol: '\n' });
  }
}
