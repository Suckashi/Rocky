// Layout previews: every format becomes one self-contained page that loads nothing and runs
// nothing. Also covers the layout bugs the previews exposed in documents Rocky creates.
import fontkit from '@pdf-lib/fontkit';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { fromMarkdown } from '../../src/server/documents/create.ts';
import { pdfFont } from '../../src/server/documents/fonts.ts';
import { openPackage, readPart } from '../../src/server/documents/ooxml.ts';
import {
  PREVIEW_PAGES,
  previewDocument,
} from '../../src/server/documents/preview.ts';
import { pdfText } from '../../src/server/documents/read.ts';

const REPORT = `# 季度報告

本季營收**成長百分之十二**。

- 台北門市
- 高雄門市

| 項目 | 金額 |
| --- | --- |
| 營收 | 100 |

表格後的說明。
`;

const CSP = `content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`;

describe('document layout previews', () => {
  it('pdf: pages become images, at most ten', async () => {
    const one = await previewDocument(await fromMarkdown(REPORT, 'pdf'), 'pdf');
    expect(one.html).toContain(CSP);
    expect(one.html.match(/<img class="pdf"/g)).toHaveLength(1);
    expect(one.html).toContain('src="data:image/png;base64,');
    expect(one.truncated).toBe(false);

    const doc = await PDFDocument.create();
    for (let i = 0; i < PREVIEW_PAGES + 2; i++) doc.addPage([200, 200]);
    const many = await previewDocument(await doc.save(), 'pdf');
    expect(many.html.match(/<img class="pdf"/g)).toHaveLength(PREVIEW_PAGES);
    expect(many.truncated).toBe(true);
  });

  it('docx: a page with headings, bold, lists and tables', async () => {
    const { html } = await previewDocument(
      await fromMarkdown(REPORT, 'docx'),
      'docx',
    );
    expect(html).toContain(CSP);
    expect(html).toContain('<h1>季度報告</h1>');
    expect(html).toContain('<strong>成長百分之十二</strong>');
    expect(html).toContain('<li>台北門市</li>');
    expect(html).toMatch(/<table>[\s\S]*營收[\s\S]*<\/table>/);
  });

  it('xlsx: a grid with styles, merged cells and column headers', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('預算');
    sheet.getCell('A1').value = '標題 <b>';
    sheet.getCell('A1').font = { bold: true };
    sheet.mergeCells('A1:C1');
    sheet.getCell('A2').value = 12.5;
    sheet.getCell('B2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFEE00' },
    };
    const { html } = await previewDocument(
      new Uint8Array(await book.xlsx.writeBuffer()),
      'xlsx',
    );
    expect(html).toContain('<h2>預算</h2>');
    expect(html).toContain('<th>C</th>');
    expect(html).toContain(
      '<td colspan="3" style="font-weight:700">標題 &#60;b&#62;</td>',
    );
    expect(html).toContain('style="text-align:right">12.5</td>');
    expect(html).toContain('background:#FFEE00');
  });

  it('pptx: slides with positioned boxes, bullets and tables', async () => {
    const { html, truncated } = await previewDocument(
      await fromMarkdown(`${REPORT}\n## 第二頁\n\n內容`, 'pptx'),
      'pptx',
    );
    expect(html.match(/<section class="slide"/g)).toHaveLength(2);
    expect(html).toContain('aspect-ratio:12192000/6858000');
    expect(html).toMatch(/• <span[^>]*>台北門市<\/span>/);
    expect(html).toMatch(/<table[\s\S]*營收[\s\S]*<\/table>/);
    expect(truncated).toBe(false);
  });

  it('md and html: rendered, with scripts and refreshes removed', async () => {
    const md = await previewDocument(
      new TextEncoder().encode('# 標題\n\n**粗體**'),
      'md',
    );
    expect(md.html).toContain('<h1>標題</h1>');
    expect(md.html).toContain('<strong>粗體</strong>');

    const page = await previewDocument(
      new TextEncoder().encode(
        '<html><head><meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script></head><body><p>你好</p><img src="https://example.com/x.png"></body></html>',
      ),
      'html',
    );
    expect(page.html.indexOf(CSP)).toBeLessThan(page.html.indexOf('<p>你好'));
    expect(page.html).toContain('<base target="_blank">');
    expect(page.html).not.toContain('refresh');
    expect(page.html).not.toContain('<script');
  });
});

describe('documents Rocky creates, as the previews showed them', () => {
  it('pptx: text before a table stays above it, without overlapping', async () => {
    const zip = await openPackage(await fromMarkdown(REPORT, 'pptx'));
    const slide = await readPart(zip, 'ppt/slides/slide1.xml');
    const top = (el: Element) => {
      const off = el.getElementsByTagName('a:off')[0]!;
      const ext = el.getElementsByTagName('a:ext')[0]!;
      return {
        y: Number(off.getAttribute('y')),
        bottom: Number(off.getAttribute('y')) + Number(ext.getAttribute('cy')),
      };
    };
    const boxes = Array.from(
      slide.getElementsByTagName('p:sp'),
    ) as unknown as Element[];
    const text = (s: string) =>
      top(boxes.find((b) => b.textContent?.includes(s))!);
    const table = top(
      slide.getElementsByTagName('p:graphicFrame')[0] as unknown as Element,
    );
    expect(text('高雄門市').bottom).toBeLessThanOrEqual(table.y);
    expect(text('表格後的說明').y).toBeGreaterThan(table.y);
  });

  it('pdf: list bullets use a character the font has', async () => {
    const font = fontkit.create(Buffer.from(pdfFont()));
    const bullet = font.characterSet.includes(0x2022) ? '•' : '-';
    const text = await pdfText(await fromMarkdown(REPORT, 'pdf'));
    expect(text).toContain(`${bullet} 台北門市`);
  });
});
