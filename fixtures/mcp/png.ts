import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
/** Explicit test image: valid PNG noise, not a screenshot or model recognition proof. */
export function largeSyntheticPng() {
  const width = 640,
    height = 480,
    rows = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++)
    randomBytes(width * 3).copy(rows, row * (width * 3 + 1) + 1);
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      bytes = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
