// Shared OOXML helpers: open the zip, parse one part, write it back, leave every other part alone.
import { DOMParser, XMLSerializer, type Document } from '@xmldom/xmldom';
import JSZip from 'jszip';

export async function openPackage(bytes: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(bytes);
}

export async function readPart(zip: JSZip, path: string): Promise<Document> {
  const file = zip.file(path);
  if (!file) throw new Error(`missing part ${path}`);
  return new DOMParser().parseFromString(
    await file.async('string'),
    'text/xml',
  );
}

export function writePart(zip: JSZip, path: string, doc: Document): void {
  zip.file(path, new XMLSerializer().serializeToString(doc));
}

export async function savePackage(zip: JSZip): Promise<Uint8Array> {
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Every part's uncompressed bytes, to prove which parts an edit touched. */
export async function partBytes(
  bytes: Uint8Array,
): Promise<Map<string, Uint8Array>> {
  const zip = await openPackage(bytes);
  const parts = new Map<string, Uint8Array>();
  for (const [path, file] of Object.entries(zip.files)) {
    if (!file.dir) parts.set(path, await file.async('uint8array'));
  }
  return parts;
}

/**
 * Replaces `find` with `replace` inside each paragraph, even when Word split the text over
 * several runs. The replacement goes into the first run it touches (keeping that run's
 * formatting); the matched remainder is removed from the following runs.
 * `paragraph` and `text` are the element names: w:p / w:t for Word, a:p / a:t for slides.
 */
export function replaceAcrossRuns(
  doc: Document,
  find: string,
  replace: string,
  names: { paragraph: string; text: string },
): number {
  let count = 0;
  const paragraphs = Array.from(doc.getElementsByTagName(names.paragraph));
  for (const paragraph of paragraphs) {
    // Search after the last replacement, so a replacement containing `find` ends the loop.
    for (let from = 0; ;) {
      const nodes = Array.from(paragraph.getElementsByTagName(names.text));
      const full = nodes.map((n) => n.textContent ?? '').join('');
      const at = full.indexOf(find, from);
      if (at === -1) break;
      from = at + replace.length;
      let position = 0;
      let remaining = find.length;
      let placed = false;
      for (const node of nodes) {
        const text = node.textContent ?? '';
        const start = position;
        position += text.length;
        if (position <= at || remaining === 0) continue;
        const from = Math.max(0, at - start);
        const take = Math.min(text.length - from, remaining);
        const next =
          text.slice(0, from) +
          (placed ? '' : replace) +
          text.slice(from + take);
        node.textContent = next;
        if (/^\s|\s$/.test(next)) node.setAttribute('xml:space', 'preserve');
        placed = true;
        remaining -= take;
      }
      count++;
    }
  }
  return count;
}
