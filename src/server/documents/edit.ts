// In-place edits that keep formatting: only the parts that change are rewritten
// (docx: word/document.xml; pptx: the touched slides; xlsx: through exceljs).
import type { Format } from './formats.ts';
import { loadWorkbook } from './read.ts';
import { setCell } from './create.ts';
import {
  openPackage,
  readPart,
  replaceAcrossRuns,
  savePackage,
  writePart,
} from './ooxml.ts';
import { slidePaths } from './read.ts';
import { decodeText, encodeText } from './text.ts';

export interface Replacement {
  find: string;
  replace: string;
}

export interface CellEdit {
  sheet?: string;
  cell: string;
  value: string;
}

export interface EditRequest {
  replacements?: Replacement[];
  cells?: CellEdit[];
}

export class EditError extends Error {}

async function replaceInParts(
  bytes: Uint8Array,
  parts: string[],
  names: { paragraph: string; text: string },
  replacements: Replacement[],
): Promise<Uint8Array> {
  const zip = await openPackage(bytes);
  for (const { find, replace } of replacements) {
    if (!find) throw new EditError('empty find text');
    let count = 0;
    for (const path of parts) {
      const doc = await readPart(zip, path);
      const n = replaceAcrossRuns(doc, find, replace, names);
      if (n > 0) writePart(zip, path, doc);
      count += n;
    }
    if (count === 0) throw new EditError(`text not found: ${find}`);
  }
  return savePackage(zip);
}

export async function editDocument(
  bytes: Uint8Array,
  format: Format,
  request: EditRequest,
): Promise<Uint8Array> {
  const replacements = request.replacements ?? [];
  const cells = request.cells ?? [];
  switch (format) {
    case 'docx':
      if (cells.length) throw new EditError('cells only apply to xlsx');
      return replaceInParts(
        bytes,
        ['word/document.xml'],
        { paragraph: 'w:p', text: 'w:t' },
        replacements,
      );
    case 'pptx':
      if (cells.length) throw new EditError('cells only apply to xlsx');
      return replaceInParts(
        bytes,
        await slidePaths(bytes),
        { paragraph: 'a:p', text: 'a:t' },
        replacements,
      );
    case 'xlsx': {
      const book = await loadWorkbook(bytes);
      for (const edit of cells) {
        const sheet = edit.sheet
          ? book.getWorksheet(edit.sheet)
          : book.worksheets[0];
        if (!sheet)
          throw new EditError(`sheet not found: ${edit.sheet ?? '(first)'}`);
        if (!/^[A-Z]{1,3}[1-9]\d*$/i.test(edit.cell))
          throw new EditError(`bad cell address: ${edit.cell}`);
        setCell(sheet.getCell(edit.cell.toUpperCase()), edit.value);
      }
      if (replacements.length) {
        for (const { find, replace } of replacements) {
          let count = 0;
          for (const sheet of book.worksheets)
            sheet.eachRow((row) =>
              row.eachCell((cell) => {
                if (
                  typeof cell.value === 'string' &&
                  cell.value.includes(find)
                ) {
                  cell.value = cell.value.split(find).join(replace);
                  count++;
                }
              }),
            );
          if (count === 0) throw new EditError(`text not found: ${find}`);
        }
      }
      book.calcProperties.fullCalcOnLoad = true;
      return new Uint8Array(await book.xlsx.writeBuffer());
    }
    case 'md':
    case 'html': {
      // Keep the file's BOM and line endings (Notepad saves BOM + CRLF).
      const file = decodeText(bytes);
      let text = file.text;
      for (const { find, replace } of replacements) {
        const f = find.replaceAll('\r\n', '\n');
        if (!f || !text.includes(f))
          throw new EditError(`text not found: ${find}`);
        text = text.split(f).join(replace.replaceAll('\r\n', '\n'));
      }
      return encodeText({ ...file, text });
    }
    case 'pdf':
      throw new EditError(
        'PDF files cannot be edited; create a new PDF instead',
      );
  }
}
