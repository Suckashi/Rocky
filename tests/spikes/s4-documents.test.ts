import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDocx,
  docxToMarkdown,
  editDocx,
} from '../../spikes/s4-documents/docx.ts';
import { extractFace, listFaces } from '../../spikes/s4-documents/fonts.ts';
import { openPackage, partBytes } from '../../spikes/s4-documents/ooxml.ts';
import {
  cmapEncodedPdf,
  createPdf,
  readPdfText,
} from '../../spikes/s4-documents/pdf.ts';
import {
  createPptx,
  editPptx,
  fromTemplate,
  pptxToMarkdown,
} from '../../spikes/s4-documents/pptx.ts';
import {
  decodeText,
  encodeText,
  markdownToHtml,
} from '../../spikes/s4-documents/text.ts';
import {
  createXlsx,
  editXlsx,
  loadXlsx,
  xlsxToMarkdown,
} from '../../spikes/s4-documents/xlsx.ts';

const font = new Uint8Array(
  readFileSync(
    join(import.meta.dirname, '../fixtures/fonts/noto-tc-subset.ttf'),
  ),
);

/** Parts whose bytes differ between two OOXML packages (added or removed parts included). */
async function changedParts(a: Uint8Array, b: Uint8Array): Promise<string[]> {
  const [pa, pb] = [await partBytes(a), await partBytes(b)];
  const names = new Set([...pa.keys(), ...pb.keys()]);
  return [...names]
    .filter((name) => {
      const x = pa.get(name);
      const y = pb.get(name);
      return !x || !y || Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0;
    })
    .sort();
}

/** A system Traditional Chinese font collection, if this machine has one. */
const systemTtc = [
  'C:\\Windows\\Fonts\\msjh.ttc',
  'C:\\Windows\\Fonts\\mingliu.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
].find((path) => existsSync(path));

describe('S4: Chinese documents', () => {
  describe('pdf', () => {
    const lines = ['繁體中文：Rocky 建立的 PDF', '含標點「引號」與數字 2026。'];

    it('creates a PDF with an embedded CJK font and reads the same text back', async () => {
      const pdf = await createPdf(lines, font);
      expect(await readPdfText(pdf)).toBe(lines.join('\n'));
    });

    it('reads text that needs the Adobe CJK CMaps, and only with them', async () => {
      const pdf = cmapEncodedPdf('舊系統的中文');
      expect(await readPdfText(pdf)).toBe('舊系統的中文');
      expect(await readPdfText(pdf, { cmaps: false })).toBe('');
    });

    it.runIf(systemTtc)(
      'embeds a face taken out of a system .ttc font collection',
      async () => {
        const ttc = new Uint8Array(readFileSync(systemTtc!));
        expect(listFaces(ttc).length).toBeGreaterThan(1);
        const pdf = await createPdf(lines, extractFace(ttc, 0));
        expect(await readPdfText(pdf)).toBe(lines.join('\n'));
      },
    );
  });

  describe('docx', () => {
    it('reads Chinese headings and bold runs as Markdown', async () => {
      const md = await docxToMarkdown(await createDocx());
      expect(md).toContain('# 季度報告');
      expect(md).toContain('本季營收__成長百分之十二__，超出預期。');
    });

    it('edits text split across runs, keeps formatting, touches only document.xml', async () => {
      const before = await createDocx();
      const { bytes, count } = await editDocx(
        before,
        '營收成長',
        '營業收入增加',
      );
      expect(count).toBe(1);
      expect(await docxToMarkdown(bytes)).toContain(
        '本季營業收入增加__百分之十二__，超出預期。',
      );
      expect(await changedParts(before, bytes)).toEqual(['word/document.xml']);
    });
  });

  describe('xlsx', () => {
    it('writes formulas without cached results and asks Excel to recalculate on open', async () => {
      const bytes = await createXlsx();
      const workbook = await (
        await openPackage(bytes)
      )
        .file('xl/workbook.xml')!
        .async('string');
      expect(workbook).toMatch(/fullCalcOnLoad="1"/);
      const md = xlsxToMarkdown(await loadXlsx(bytes));
      expect(md).toContain('## 銷售報表');
      expect(md).toContain('| 台北 | 12 | 3600 |');
      expect(md).toContain('=SUM(C3:C4)');
    });

    it('edits cells and keeps styles, merges, notes, validation and conditional formats', async () => {
      const before = await createXlsx();
      const after = await editXlsx(before, (book) => {
        const sheet = book.getWorksheet('銷售報表')!;
        sheet.getCell('A4').value = '高雄市';
        sheet.getCell('B4').value = 10;
      });
      const sheet = (await loadXlsx(after)).getWorksheet('銷售報表')!;
      expect(sheet.getCell('A4').value).toBe('高雄市');
      expect(sheet.getCell('A1').font).toMatchObject({
        name: 'Microsoft JhengHei',
        bold: true,
      });
      expect(sheet.getCell('A2').fill).toMatchObject({
        fgColor: { argb: 'FFDDEBF7' },
      });
      expect(sheet.getCell('A1').isMerged && sheet.getCell('C1').isMerged).toBe(
        true,
      );
      expect(sheet.getColumn('A').width).toBe(18);
      expect(sheet.getCell('B3').note).toBe('含退貨');
      expect(sheet.getCell('B3').dataValidation).toMatchObject({
        type: 'whole',
      });
      // Present at runtime, missing from exceljs's types.
      const formats = (
        sheet as unknown as { conditionalFormattings: unknown[] }
      ).conditionalFormattings;
      expect(formats).toHaveLength(1);
      expect(sheet.getCell('C5').value).toEqual({ formula: 'SUM(C3:C4)' });
      expect(await changedParts(before, after)).toEqual([
        'xl/sharedStrings.xml',
        'xl/worksheets/sheet1.xml',
      ]);
    });
  });

  describe('pptx', () => {
    it('reads slides in presentation order with Chinese text and East Asian fonts', async () => {
      const bytes = await createPptx();
      const md = await pptxToMarkdown(bytes);
      expect(md).toContain(
        '## 投影片 1\n\n產品發表會\n\n新功能：支援繁體中文文件的讀寫與編輯。',
      );
      expect(md).toContain('## 投影片 2');
      const slide = await (
        await openPackage(bytes)
      )
        .file('ppt/slides/slide1.xml')!
        .async('string');
      expect(slide).toContain('<a:ea typeface="Microsoft JhengHei"');
    });

    it('edits text across runs in place, touching only that slide', async () => {
      const before = await createPptx();
      const { bytes, count } = await editPptx(
        before,
        '新功能：支援',
        '新版本支援',
      );
      expect(count).toBe(1);
      expect(await pptxToMarkdown(bytes)).toContain(
        '新版本支援繁體中文文件的讀寫與編輯。',
      );
      expect(await changedParts(before, bytes)).toEqual([
        'ppt/slides/slide1.xml',
      ]);
    });

    it('builds a deck from a template without leaving the template slides inside', async () => {
      const deck = await fromTemplate(
        await createPptx(),
        '由範本產生的中文內容',
      );
      expect(await pptxToMarkdown(deck)).toBe(
        '## 投影片 1\n\n產品發表會\n\n由範本產生的中文內容',
      );
      const parts = await partBytes(deck);
      const leftovers = [...parts.values()].filter((bytes) =>
        Buffer.from(bytes).toString('utf8').includes('新功能'),
      );
      expect(leftovers).toHaveLength(0);
    });
  });

  describe('md and html', () => {
    it('keeps the BOM and CRLF of a Notepad file through an edit', () => {
      const original = encodeText({
        text: '# 筆記\n\n第一行\n第二行\n',
        bom: true,
        eol: '\r\n',
      });
      const file = decodeText(original);
      expect(file).toMatchObject({ bom: true, eol: '\r\n' });
      const edited = encodeText({
        ...file,
        text: file.text.replace('第二行', '第二行（已修改）'),
      });
      expect(Buffer.from(edited).subarray(0, 3)).toEqual(
        Buffer.from([0xef, 0xbb, 0xbf]),
      );
      expect(decodeText(edited).text).toBe(
        '# 筆記\n\n第一行\n第二行（已修改）\n',
      );
      expect(Buffer.from(edited).toString('utf8')).toContain('第一行\r\n');
    });

    it('refuses a non-UTF-8 file instead of corrupting it', () => {
      const big5 = new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5]); // 中文 in Big5
      expect(() => decodeText(big5)).toThrow();
    });

    it('renders Chinese Markdown to HTML and back to the same text', () => {
      const html = markdownToHtml('# 標題\n\n**粗體**與一般文字');
      expect(html).toBe(
        '<h1>標題</h1>\n<p><strong>粗體</strong>與一般文字</p>\n',
      );
      const roundTrip = decodeText(
        encodeText({ text: html, bom: false, eol: '\n' }),
      ).text;
      expect(roundTrip).toBe(html);
    });
  });
});
