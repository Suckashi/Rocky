// S3 smoke test: every planned library loads and does one real thing on this platform.
// Run after install-check.ts. Exits non-zero on any failure.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const here = import.meta.dirname;
const out = mkdtempSync(join(tmpdir(), 'rocky-s3-'));
const results: [string, string][] = [];
let failed = false;

async function check(name: string, run: () => Promise<string> | string) {
  try {
    results.push([name, `ok: ${await run()}`]);
  } catch (error) {
    failed = true;
    results.push([
      name,
      `FAIL: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await check('node:sqlite FTS5 trigram (Chinese)', () => {
  const db = new DatabaseSync(':memory:');
  const version = (
    db.prepare('select sqlite_version() as v').get() as { v: string }
  ).v;
  db.exec("create virtual table notes using fts5(body, tokenize = 'trigram')");
  const insert = db.prepare('insert into notes(body) values (?)');
  insert.run('今天修好了登入頁面的錯誤');
  insert.run('記憶搜尋要支援中文');
  const match = db
    .prepare('select body from notes where notes match ?')
    .all('"登入頁"');
  expect(match.length === 1, `trigram match returned ${match.length}`);
  // Trigram needs three characters; two-character queries fall back to LIKE.
  const short = db
    .prepare('select body from notes where body like ?')
    .all('%中文%');
  expect(short.length === 1, `LIKE fallback returned ${short.length}`);
  db.close();
  return `SQLite ${version}`;
});

await check('import every planned package', async () => {
  const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const skip = new Set(['@ag-ui/core', 'zod', 'langsmith', '@tiptap/pm']); // no root export / covered elsewhere
  const names = Object.keys(pkg.dependencies).filter((name) => !skip.has(name));
  for (const name of names) await import(name);
  return `${names.length} packages`;
});

await check('vite build (rolldown + lightningcss + React)', async () => {
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  await build({
    root: join(here, 'fixtures', 'app'),
    logLevel: 'silent',
    plugins: [react()],
    css: { transformer: 'lightningcss' },
    build: { outDir: join(out, 'app'), cssMinify: 'lightningcss' },
  });
  expect(existsSync(join(out, 'app', 'index.html')), 'no index.html');
  return 'built';
});

await check('hono on 127.0.0.1', async () => {
  const { Hono } = await import('hono');
  const { serve } = await import('@hono/node-server');
  const app = new Hono().get('/', (c) => c.text('Roko'));
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () =>
      resolve(s),
    );
  });
  const { port } = server.address() as { port: number };
  const body = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  server.close();
  expect(body === 'Roko', body);
  return `port ${port}`;
});

await check('markdown-it', async () => {
  const MarkdownIt = (await import('markdown-it')).default;
  const html = new MarkdownIt().render('# 標題');
  expect(html.includes('<h1>標題</h1>'), html);
  return 'rendered';
});

await check('docx → mammoth (Chinese)', async () => {
  const { Document, Packer, Paragraph } = await import('docx');
  const mammoth = (await import('mammoth')).default;
  const doc = new Document({
    sections: [{ children: [new Paragraph('繁體中文段落')] }],
  });
  const buffer = await Packer.toBuffer(doc);
  const { value } = await mammoth.extractRawText({ buffer });
  expect(value.includes('繁體中文段落'), value);
  return `${buffer.length} bytes`;
});

await check('exceljs (Chinese, formula)', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('工作表');
  sheet.getCell('A1').value = '數量';
  sheet.getCell('A2').value = 2;
  sheet.getCell('A3').value = { formula: 'A2*3' };
  const buffer = await book.xlsx.writeBuffer();
  const again = new ExcelJS.Workbook();
  await again.xlsx.load(buffer);
  const back = again.getWorksheet('工作表');
  expect(back?.getCell('A1').value === '數量', 'Chinese cell lost');
  return `${buffer.byteLength} bytes`;
});

await check('pptxgenjs', async () => {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pres = new PptxGenJS();
  pres.addSlide().addText('簡報標題', { x: 1, y: 1 });
  const data = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  expect(data.length > 0, 'empty pptx');
  return `${data.length} bytes`;
});

await check('pdf-lib + fontkit → unpdf', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const { extractText } = await import('unpdf');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Rocky S3', { x: 50, y: 700, font, size: 24 });
  const bytes = await pdf.save();
  const { text } = await extractText(bytes, { mergePages: true });
  expect(String(text).includes('Rocky S3'), String(text));
  return `${bytes.length} bytes`;
});

await check('playwright-core → system Edge → PDF (Chinese)', async () => {
  const { chromium } = await import('playwright-core');
  const executablePath = process.env['ROCKY_S3_BROWSER'];
  let browser;
  try {
    browser = await chromium.launch(
      executablePath ? { executablePath } : { channel: 'msedge' },
    );
  } catch (error) {
    if (process.platform !== 'win32' && !executablePath) {
      return `skipped: no Edge on ${process.platform} (${String(error).split('\n')[0]})`;
    }
    throw error;
  }
  const page = await browser.newPage();
  await page.setContent('<h1>繁體中文 PDF</h1>');
  const pdf = await page.pdf();
  const version = browser.version();
  await browser.close();
  const { extractText } = await import('unpdf');
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  expect(String(text).includes('繁體中文'), `extracted: ${String(text)}`);
  return `${executablePath ? 'custom browser' : 'msedge'} ${version}, ${pdf.length} bytes`;
});

console.log('--- S3 smoke report ---');
console.log(`node ${process.version} on ${process.platform}-${process.arch}`);
for (const [name, result] of results) console.log(`${name}: ${result}`);
process.exit(failed ? 1 : 0);
