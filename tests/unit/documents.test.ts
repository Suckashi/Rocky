// M4: the six formats with Chinese content: create from Markdown, read back, edit in place,
// read again. Office edits must keep formatting and leave untouched parts alone.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fromMarkdown } from '../../src/server/documents/create.ts';
import { editDocument, EditError } from '../../src/server/documents/edit.ts';
import { formatOf } from '../../src/server/documents/formats.ts';
import { partBytes } from '../../src/server/documents/ooxml.ts';
import { loadWorkbook, toMarkdown } from '../../src/server/documents/read.ts';
import { decodeText } from '../../src/server/documents/text.ts';
import { cmapEncodedPdf } from '../fixtures/cmap-pdf.ts';

/** A system Traditional Chinese font collection, if this machine has one. */
const systemTtc = [
  'C:\\Windows\\Fonts\\msjh.ttc',
  'C:\\Windows\\Fonts\\mingliu.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
].find((path) => existsSync(path));

const REPORT = `# 季度報告

本季營收**成長百分之十二**，超出預期。

- 台北門市
- 高雄門市

| 項目 | 金額 |
| --- | --- |
| 營收 | 一百萬 |
`;

async function changedParts(a: Uint8Array, b: Uint8Array): Promise<string[]> {
  const [pa, pb] = [await partBytes(a), await partBytes(b)];
  return [...new Set([...pa.keys(), ...pb.keys()])]
    .filter((name) => {
      const x = pa.get(name);
      const y = pb.get(name);
      return !x || !y || Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0;
    })
    .sort();
}

beforeAll(() => {
  // The fixture is a subset of Noto Sans TC with the characters the PDF test uses.
  process.env['ROCKY_PDF_FONT'] = join(
    import.meta.dirname,
    '../fixtures/fonts/noto-tc-subset.ttf',
  );
});

describe('document formats', () => {
  it('knows the six formats by extension', () => {
    expect(
      [
        'a.PDF',
        'b.docx',
        'c.xlsx',
        'd.pptx',
        'e.markdown',
        'f.htm',
        'g.txt',
      ].map(formatOf),
    ).toEqual(['pdf', 'docx', 'xlsx', 'pptx', 'md', 'html', undefined]);
  });

  it('docx: Markdown in, Markdown out (heading, bold, list, table), edit keeps the bold run', async () => {
    const bytes = await fromMarkdown(REPORT, 'docx');
    const md = await toMarkdown(bytes, 'docx');
    expect(md).toContain('# 季度報告');
    expect(md).toContain('**成長百分之十二**');
    expect(md).toContain('- 台北門市');
    expect(md).toContain('| 營收 | 一百萬 |');

    const edited = await editDocument(bytes, 'docx', {
      replacements: [{ find: '百分之十二', replace: '百分之十五' }],
    });
    const after = await toMarkdown(edited, 'docx');
    expect(after).toContain('**成長百分之十五**');
    expect(after).toContain('| 營收 | 一百萬 |');
    expect(await changedParts(bytes, edited)).toEqual(['word/document.xml']);
  });

  it('xlsx: tables become sheets, formulas are recalculated on open, cell edits keep the rest', async () => {
    const bytes = await fromMarkdown(
      '## 銷售\n\n| 地區 | 金額 |\n| --- | --- |\n| 台北 | 3600 |\n| 高雄 | 2400 |\n| 合計 | =SUM(B2:B3) |\n',
      'xlsx',
    );
    expect(await toMarkdown(bytes, 'xlsx')).toContain('| 合計 | =SUM(B2:B3) |');
    const book = await loadWorkbook(bytes);
    // exceljs does not read calcPr back; check the workbook part itself.
    const workbookXml = new TextDecoder().decode(
      (await partBytes(bytes)).get('xl/workbook.xml'),
    );
    expect(workbookXml).toContain('fullCalcOnLoad="1"');
    expect(book.getWorksheet('銷售')?.getCell('B2').value).toBe(3600);

    const edited = await editDocument(bytes, 'xlsx', {
      cells: [{ sheet: '銷售', cell: 'B3', value: '2500' }],
      replacements: [{ find: '高雄', replace: '台中' }],
    });
    const md = await toMarkdown(edited, 'xlsx');
    expect(md).toContain('| 台中 | 2500 |');
    expect(md).toContain('| 台北 | 3600 |');
    expect(
      (await loadWorkbook(edited)).getWorksheet('銷售')?.getRow(1).font?.bold,
    ).toBe(true);
  });

  it('pptx: headings start slides, read in order, edit only touches that slide', async () => {
    const bytes = await fromMarkdown(
      '# 產品發表會\n\n支援繁體中文文件。\n\n## 時程\n\n- 十月：測試\n- 十一月：上線\n',
      'pptx',
    );
    const md = await toMarkdown(bytes, 'pptx');
    expect(md.indexOf('產品發表會')).toBeLessThan(md.indexOf('時程'));
    expect(md).toContain('## Slide 2');
    expect(md).toContain('十一月：上線');

    const edited = await editDocument(bytes, 'pptx', {
      replacements: [{ find: '上線', replace: '正式上線' }],
    });
    expect(await toMarkdown(edited, 'pptx')).toContain('十一月：正式上線');
    expect(await changedParts(bytes, edited)).toEqual([
      'ppt/slides/slide2.xml',
    ]);
  });

  it('pdf: created with an embedded CJK font, read back as text; editing is refused', async () => {
    const bytes = await fromMarkdown(
      '繁體中文：Rocky 建立的 PDF\n\n含標點「引號」與數字 2026。',
      'pdf',
    );
    const md = await toMarkdown(bytes, 'pdf');
    expect(md).toContain('繁體中文：Rocky 建立的 PDF');
    expect(md).toContain('含標點「引號」與數字 2026。');
    await expect(
      editDocument(bytes, 'pdf', {
        replacements: [{ find: 'a', replace: 'b' }],
      }),
    ).rejects.toThrow(EditError);
  });

  it('pdf: reads Chinese that needs the Adobe CJK CMaps (older Taiwanese office files)', async () => {
    expect(await toMarkdown(cmapEncodedPdf('舊系統的中文'), 'pdf')).toContain(
      '舊系統的中文',
    );
  });

  it.runIf(systemTtc)(
    'pdf: embeds a face taken out of a system .ttc font collection',
    async () => {
      const fixture = process.env['ROCKY_PDF_FONT'];
      process.env['ROCKY_PDF_FONT'] = systemTtc!;
      try {
        const bytes = await fromMarkdown('繁體中文：系統字型', 'pdf');
        expect(await toMarkdown(bytes, 'pdf')).toContain('繁體中文：系統字型');
      } finally {
        process.env['ROCKY_PDF_FONT'] = fixture;
      }
    },
    // Parsing and subsetting a ~20 MB system font can take over 5 s on the Windows runner.
    30_000,
  );

  it('md: edits keep a BOM and CRLF line endings', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const bytes = new Uint8Array(
      Buffer.concat([bom, Buffer.from('# 筆記\r\n\r\n第一行\r\n', 'utf8')]),
    );
    const edited = await editDocument(bytes, 'md', {
      replacements: [{ find: '第一行', replace: '修改後的第一行' }],
    });
    const file = decodeText(edited);
    expect(file).toMatchObject({ bom: true, eol: '\r\n' });
    expect(file.text).toBe('# 筆記\n\n修改後的第一行\n');
  });

  it('html: a UTF-8 page from Markdown, round trip and edit', async () => {
    const bytes = await fromMarkdown(REPORT, 'html', '季度報告');
    const html = await toMarkdown(bytes, 'html');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<h1>季度報告</h1>');
    const edited = await editDocument(bytes, 'html', {
      replacements: [{ find: '一百萬', replace: '兩百萬' }],
    });
    expect(await toMarkdown(edited, 'html')).toContain('<td>兩百萬</td>');
  });

  it('refuses text that is not there and non-UTF-8 text files', async () => {
    const docx = await fromMarkdown('你好', 'docx');
    await expect(
      editDocument(docx, 'docx', {
        replacements: [{ find: '再見', replace: 'x' }],
      }),
    ).rejects.toThrow('text not found');
    const big5 = new Uint8Array([0xa7, 0x41, 0xa6, 0x6e]); // 你好 in Big5
    await expect(toMarkdown(big5, 'md')).rejects.toThrow();
  });
});
