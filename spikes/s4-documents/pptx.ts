// pptx: create with pptxgenjs, read slide text, edit in place, or build from a template
// with pptx-automizer.
import { Automizer, modify } from 'pptx-automizer';
import pptxgen from 'pptxgenjs';
import {
  openPackage,
  readPart,
  replaceAcrossRuns,
  savePackage,
  writePart,
} from './ooxml.ts';

// Its types are CommonJS-shaped under NodeNext; at runtime the default export is the class.
const PptxGenJS = pptxgen as unknown as typeof pptxgen.default;

export async function createPptx(): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  const font = 'Microsoft JhengHei';
  const slide = pres.addSlide();
  slide.addText('產品發表會', {
    objectName: 'Title',
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 1,
    fontFace: font,
    fontSize: 32,
    bold: true,
  });
  slide.addText(
    [
      { text: '新功能：', options: { bold: true } },
      { text: '支援繁體中文文件的讀寫與編輯。' },
    ],
    {
      objectName: 'Body',
      x: 0.5,
      y: 1.6,
      w: 9,
      h: 1,
      fontFace: font,
      fontSize: 18,
    },
  );
  const second = pres.addSlide();
  second.addTable(
    [
      [{ text: '項目' }, { text: '狀態' }],
      [{ text: '讀取' }, { text: '完成' }],
    ],
    { x: 0.5, y: 0.5, w: 6, fontFace: font },
  );
  return new Uint8Array(
    (await pres.write({ outputType: 'nodebuffer' })) as Buffer,
  );
}

/** Slides in presentation order, from ppt/presentation.xml (files can outlive their slide). */
async function slidePaths(bytes: Uint8Array): Promise<string[]> {
  const zip = await openPackage(bytes);
  const pres = await readPart(zip, 'ppt/presentation.xml');
  const rels = await readPart(zip, 'ppt/_rels/presentation.xml.rels');
  const target = new Map(
    Array.from(rels.getElementsByTagName('Relationship')).map((r) => [
      r.getAttribute('Id'),
      `ppt/${r.getAttribute('Target')}`,
    ]),
  );
  return Array.from(pres.getElementsByTagName('p:sldId')).map((id) => {
    const path = target.get(id.getAttribute('r:id'));
    if (!path) throw new Error('slide relationship missing');
    return path;
  });
}

export async function pptxToMarkdown(bytes: Uint8Array): Promise<string> {
  const zip = await openPackage(bytes);
  const out: string[] = [];
  for (const [index, path] of (await slidePaths(bytes)).entries()) {
    const doc = await readPart(zip, path);
    const lines = Array.from(doc.getElementsByTagName('a:p'))
      .map((p) =>
        Array.from(p.getElementsByTagName('a:t'))
          .map((t) => t.textContent ?? '')
          .join(''),
      )
      .filter(Boolean);
    out.push(`## 投影片 ${index + 1}\n\n${lines.join('\n\n')}`);
  }
  return out.join('\n\n');
}

export async function editPptx(
  bytes: Uint8Array,
  find: string,
  replace: string,
): Promise<{ bytes: Uint8Array; count: number }> {
  const zip = await openPackage(bytes);
  let count = 0;
  for (const path of await slidePaths(bytes)) {
    const doc = await readPart(zip, path);
    const n = replaceAcrossRuns(doc, find, replace, {
      paragraph: 'a:p',
      text: 'a:t',
    });
    if (n > 0) writePart(zip, path, doc);
    count += n;
  }
  return { bytes: await savePackage(zip), count };
}

/** Copies slide 1 of `template` into a new deck and sets the text of its "Body" shape. */
export async function fromTemplate(
  template: Uint8Array,
  body: string,
): Promise<Uint8Array> {
  const automizer = new Automizer({
    templateDir: '.',
    outputDir: '.',
    removeExistingSlides: true,
    autoImportSlideMasters: false,
    cleanup: true,
  });
  const buffer = Buffer.from(template);
  const pres = automizer.loadRoot(buffer).load(buffer, 'template');
  pres.addSlide('template', 1, (slide) => {
    slide.modifyElement('Body', [modify.setText(body)]);
  });
  const zip = await pres.getJSZip();
  return savePackage(zip);
}
