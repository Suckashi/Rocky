// docx: create with `docx`, read as Markdown with mammoth, edit the XML in place.
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import mammoth from 'mammoth';
import {
  openPackage,
  readPart,
  replaceAcrossRuns,
  savePackage,
  writePart,
} from './ooxml.ts';

export async function createDocx(): Promise<Uint8Array> {
  const cell = (text: string) =>
    new TableCell({ children: [new Paragraph(text)] });
  const doc = new Document({
    styles: {
      // Chinese text is drawn with the East Asian font; without it Word falls back per machine.
      default: {
        document: {
          run: { font: { ascii: 'Calibri', eastAsia: 'Microsoft JhengHei' } },
        },
      },
    },
    sections: [
      {
        children: [
          new Paragraph({ text: '季度報告', heading: HeadingLevel.HEADING_1 }),
          // Word often splits one sentence into several runs; this paragraph does on purpose.
          new Paragraph({
            children: [
              new TextRun('本季營收'),
              new TextRun({ text: '成長百分之十二', bold: true }),
              new TextRun('，超出預期。'),
            ],
          }),
          new Table({
            rows: [
              new TableRow({ children: [cell('項目'), cell('金額')] }),
              new TableRow({ children: [cell('營收'), cell('一百萬')] }),
            ],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  // convertToMarkdown exists but is deprecated and missing from mammoth's types.
  const { convertToMarkdown } = mammoth as unknown as {
    convertToMarkdown: (input: {
      buffer: Buffer;
    }) => Promise<{ value: string }>;
  };
  const { value } = await convertToMarkdown({ buffer: Buffer.from(bytes) });
  return value;
}

export async function editDocx(
  bytes: Uint8Array,
  find: string,
  replace: string,
): Promise<{ bytes: Uint8Array; count: number }> {
  const zip = await openPackage(bytes);
  const doc = await readPart(zip, 'word/document.xml');
  const count = replaceAcrossRuns(doc, find, replace, {
    paragraph: 'w:p',
    text: 'w:t',
  });
  writePart(zip, 'word/document.xml', doc);
  return { bytes: await savePackage(zip), count };
}
