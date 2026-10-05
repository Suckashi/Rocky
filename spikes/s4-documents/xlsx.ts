// xlsx: create and edit with exceljs. Rocky cannot calculate formulas, so it writes no cached
// results and asks Excel to recalculate on open (fullCalcOnLoad).
import ExcelJS from 'exceljs';

export async function createXlsx(): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.calcProperties.fullCalcOnLoad = true;
  const sheet = book.addWorksheet('銷售報表', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = '二〇二六年第三季銷售';
  sheet.getCell('A1').font = {
    name: 'Microsoft JhengHei',
    bold: true,
    size: 14,
  };
  sheet.addRow(['地區', '數量', '金額']);
  sheet.getRow(2).font = { bold: true };
  sheet.getRow(2).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDDEBF7' },
  };
  sheet.addRow(['台北', 12, 3600]);
  sheet.addRow(['高雄', 8, 2400]);
  sheet.getCell('C5').value = { formula: 'SUM(C3:C4)' };
  sheet.getCell('C5').numFmt = '#,##0';
  sheet.getColumn('A').width = 18;
  sheet.getCell('B3').note = '含退貨';
  sheet.getCell('B3').dataValidation = {
    type: 'whole',
    operator: 'greaterThan',
    formulae: [0],
  };
  sheet.addConditionalFormatting({
    ref: 'C3:C4',
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        priority: 1,
        formulae: [3000],
        style: { font: { color: { argb: 'FFC00000' } } },
      },
    ],
  });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export async function loadXlsx(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return book;
}

export async function editXlsx(
  bytes: Uint8Array,
  edit: (book: ExcelJS.Workbook) => void,
): Promise<Uint8Array> {
  const book = await loadXlsx(bytes);
  edit(book);
  book.calcProperties.fullCalcOnLoad = true;
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** Sheet contents as Markdown tables; formulas without a cached result show as =FORMULA. */
export function xlsxToMarkdown(book: ExcelJS.Workbook): string {
  const show = (value: ExcelJS.CellValue): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && 'formula' in value) {
      return value.result === undefined
        ? `=${value.formula}`
        : String(value.result);
    }
    if (typeof value === 'object' && 'richText' in value) {
      return value.richText.map((part) => part.text).join('');
    }
    return String(value);
  };
  return book.worksheets
    .map((sheet) => {
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        for (let c = 1; c <= sheet.columnCount; c++)
          cells.push(show(row.getCell(c).value));
        rows.push(cells);
      });
      const [head = [], ...body] = rows;
      const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
      return [
        `## ${sheet.name}`,
        line(head),
        line(head.map(() => '---')),
        ...body.map(line),
      ].join('\n');
    })
    .join('\n\n');
}
