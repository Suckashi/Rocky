// pdf-lib's fontkit cannot embed a TrueType Collection (.ttc), and the Traditional Chinese
// fonts that ship with Windows (msjh.ttc, mingliu.ttc) are collections. This copies one
// face out of a collection into a standalone font file (ADR 0005, finding 2).
import { existsSync, readFileSync } from 'node:fs';

const tag = (view: DataView, at: number) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );

function faceOffsets(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag(view, 0) !== 'ttcf') return [0];
  const count = view.getUint32(8);
  return Array.from({ length: count }, (_, i) => view.getUint32(12 + i * 4));
}

/** Returns face `index` as a standalone .ttf/.otf. A plain font file is returned as is. */
export function extractFace(bytes: Uint8Array, index = 0): Uint8Array {
  const offsets = faceOffsets(bytes);
  if (offsets.length === 1 && offsets[0] === 0) return bytes;
  const offset = offsets[index];
  if (offset === undefined) throw new Error(`face ${index} not in collection`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = view.getUint16(offset + 4);
  const headerSize = 12 + tables * 16;
  const records = Array.from({ length: tables }, (_, t) => {
    const at = offset + 12 + t * 16;
    return {
      at,
      start: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
    };
  });
  const padded = (n: number) => (n + 3) & ~3;
  const size = records.reduce((sum, r) => sum + padded(r.length), headerSize);
  const out = new Uint8Array(size);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(offset, offset + 12), 0);
  let cursor = headerSize;
  records.forEach((record, t) => {
    const at = 12 + t * 16;
    out.set(bytes.subarray(record.at, record.at + 16), at);
    outView.setUint32(at + 8, cursor);
    out.set(bytes.subarray(record.start, record.start + record.length), cursor);
    cursor += padded(record.length);
  });
  return out;
}

/** Traditional Chinese fonts that ship with each OS (collections are fine: extractFace). */
const SYSTEM_FONTS: Record<string, string[]> = {
  win32: [
    'C:\\Windows\\Fonts\\msjh.ttc',
    'C:\\Windows\\Fonts\\msjh.ttf',
    'C:\\Windows\\Fonts\\mingliu.ttc',
    'C:\\Windows\\Fonts\\kaiu.ttf',
  ],
  darwin: [
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  ],
  linux: [
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
  ],
};

let cached: { path: string; face: Uint8Array } | undefined;

/** A standalone CJK font for PDFs: ROCKY_PDF_FONT, else a system font. Cached (it is slow). */
export function pdfFont(): Uint8Array {
  const configured = process.env['ROCKY_PDF_FONT'];
  const candidates = configured
    ? [configured]
    : (SYSTEM_FONTS[process.platform] ?? []);
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error('no-cjk-font');
  if (cached?.path === path) return cached.face;
  const face = extractFace(new Uint8Array(readFileSync(path)), 0);
  cached = { path, face };
  return face;
}
