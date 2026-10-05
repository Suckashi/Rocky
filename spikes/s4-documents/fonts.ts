// pdf-lib's fontkit cannot embed a TrueType Collection (.ttc), and the Traditional Chinese
// fonts that ship with Windows (msjh.ttc, mingliu.ttc) are collections. This copies one
// face out of a collection into a standalone font file.

export interface FaceInfo {
  index: number;
  family: string;
}

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

/** Family names (name ID 1, Windows Unicode) of every face, for picking one. */
export function listFaces(bytes: Uint8Array): FaceInfo[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return faceOffsets(bytes).map((offset, index) => {
    const tables = view.getUint16(offset + 4);
    let family = '';
    for (let t = 0; t < tables; t++) {
      const record = offset + 12 + t * 16;
      if (tag(view, record) !== 'name') continue;
      const name = view.getUint32(record + 8);
      const count = view.getUint16(name + 2);
      const strings = name + view.getUint16(name + 4);
      for (let n = 0; n < count; n++) {
        const at = name + 6 + n * 12;
        const [platform, , language, id, length, start] = [
          0, 2, 4, 6, 8, 10,
        ].map((d) => view.getUint16(at + d)) as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        if (platform !== 3 || id !== 1) continue;
        const raw = bytes.subarray(strings + start, strings + start + length);
        const text = new TextDecoder('utf-16be').decode(raw);
        if (!family || language === 0x0404) family = text; // prefer the zh-TW name
      }
    }
    return { index, family };
  });
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
