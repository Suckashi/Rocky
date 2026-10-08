// md and html are text: decode, edit, encode back with the same BOM and line endings.
// Files saved by Windows Notepad often start with a UTF-8 BOM and use CRLF.

export interface TextFile {
  text: string;
  bom: boolean;
  eol: '\r\n' | '\n';
}

export function decodeText(bytes: Uint8Array): TextFile {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  // fatal: a non-UTF-8 file (for example Big5) must fail loudly instead of turning into U+FFFD.
  const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    bom ? bytes.subarray(3) : bytes,
  );
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { text: raw.replaceAll('\r\n', '\n'), bom, eol };
}

export function encodeText(file: TextFile): Uint8Array {
  const body = new TextEncoder().encode(file.text.replaceAll('\n', file.eol));
  if (!file.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}
