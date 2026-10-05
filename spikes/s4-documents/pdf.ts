// PDF: read text with unpdf (pdf.js) including the Adobe CJK CMaps; create with pdf-lib.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * unpdf points pdf.js at the CMaps with a file:// URL string, which pdf.js's Node reader
 * passes to fs.readFile and fails on. A plain directory path works, but pdf.js insists on
 * a trailing "/", so Windows backslashes become forward slashes (fs accepts both).
 */
const cMapDir = (() => {
  const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
  return `${join(dirname(pkg), 'cmaps').split(sep).join('/')}/`;
})();

export async function readPdfText(
  bytes: Uint8Array,
  options: { cmaps?: boolean } = {},
): Promise<string> {
  const copy = bytes.slice(); // pdf.js transfers the buffer it is given
  const doc = await getDocumentProxy(
    copy,
    options.cmaps === false ? {} : { cMapUrl: cMapDir, cMapPacked: true },
  );
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

export async function createPdf(
  lines: string[],
  font: Uint8Array,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embedded = await pdf.embedFont(font, { subset: true });
  const page = pdf.addPage();
  lines.forEach((line, i) =>
    page.drawText(line, { x: 48, y: 760 - i * 28, size: 16, font: embedded }),
  );
  return pdf.save();
}

/**
 * A PDF whose Chinese text uses a non-embedded font and the predefined CMap UniCNS-UCS2-H,
 * as older Taiwanese office software produces. Only a reader with the CMaps can decode it.
 */
export function cmapEncodedPdf(text: string): Uint8Array {
  const hex = [...text]
    .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');
  const stream = `BT /F1 24 Tf 72 720 Td <${hex}> Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /MingLiU /Encoding /UniCNS-UCS2-H /DescendantFonts [6 0 R] >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MingLiU /CIDSystemInfo << /Registry (Adobe) /Ordering (CNS1) /Supplement 0 >> /FontDescriptor 7 0 R >>',
    '<< /Type /FontDescriptor /FontName /MingLiU /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export const readFont = (path: string) => new Uint8Array(readFileSync(path));
