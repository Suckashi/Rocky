// End-to-end check of the chat UI in a real browser against a scripted model.
// Not part of CI (too heavy for every push). Run: npm run test:e2e
//   ROCKY_E2E_BROWSER  path to a Chromium-based browser; default: the system Edge (msedge)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startFakeOpenAI } from '../spikes/s2-agent/fake-openai.ts';

const REPLY = '你好！我是 Rocky。這是**測試回覆**。';
const port = 4390 + Math.floor(Math.random() * 9);
const root = join(import.meta.dirname, '..');

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`e2e failed: ${message}`);
  console.log(`ok - ${message}`);
}

const fake = await startFakeOpenAI(() => ({ text: REPLY }));
const server = spawn(
  process.execPath,
  [join(root, 'src', 'server', 'start.ts')],
  {
    env: {
      ...process.env,
      ROCKY_DATA_DIR: mkdtempSync(join(tmpdir(), 'rocky-e2e-')),
      ROCKY_PORT: String(port),
      ROCKY_OPEN_BROWSER: '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
const url = await new Promise<string>((resolve, reject) => {
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (text: string) => {
    const match = /(http:\/\/127\.0\.0\.1:\d+\/\?code=\S+)/.exec(text);
    if (match) resolve(match[1]!);
  });
  server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
});

const executablePath = process.env['ROCKY_E2E_BROWSER'];
const browser = await chromium.launch(
  executablePath ? { executablePath } : { channel: 'msedge' },
);
let failed = false;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page: Page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(url);
  await page.getByText('選好模型就能開始').waitFor();
  check(true, 'onboarding shows in Traditional Chinese by default');
  await page.getByLabel('網址').fill(fake.baseURL);
  await page.getByRole('combobox', { name: '模型' }).fill('fake-model');
  await page.getByRole('button', { name: '儲存' }).click();
  await page.getByText('已儲存').waitFor();
  await page.getByRole('button', { name: '開始和 Roko 對話' }).click();

  const box = page.getByRole('textbox');
  await box.fill('你好，請自我介紹');
  await page.keyboard.press('Enter');
  await page.getByText('測試回覆').waitFor({ timeout: 20_000 });
  check(true, 'a Chinese message gets a streamed reply rendered as Markdown');
  await page.locator('.threads li', { hasText: '你好，請自我介紹' }).waitFor();
  check(true, 'the conversation is named after its first message');

  await page.reload();
  await page.getByText('測試回覆').waitFor();
  check(true, 'history survives a reload (stored locally)');

  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await page.getByText('Interface language').waitFor();
  check(true, 'the interface switches to English');

  const stranger = await browser.newContext();
  const other = await stranger.newPage();
  await other.goto(`http://127.0.0.1:${port}/`);
  await other.getByText('請從啟動程式開啟 Rocky').waitFor();
  check(true, 'a tab without the launcher session sees the locked page');

  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser.close();
  server.kill('SIGINT');
  await fake.close();
}
process.exit(failed ? 1 : 0);
