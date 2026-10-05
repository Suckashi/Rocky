// End-to-end check of the chat UI in a real browser against a scripted model.
// Not part of CI (too heavy for every push). Run: npm run test:e2e
//   ROCKY_E2E_BROWSER  path to a Chromium-based browser; default: the system Edge (msedge)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

// Asked to change something, the model edits /app.js; once a tool answered, it reports back.
const fake = await startFakeOpenAI((messages) => {
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const results = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (results.length > 0)
    return { text: `已處理。工具回覆：${String(results.at(-1)!.content)}` };
  if (JSON.stringify(messages[lastUser]?.content ?? '').includes('改'))
    return {
      toolCalls: [
        {
          name: 'edit_file',
          args: {
            file_path: '/app.js',
            old_string: 'answer = 41',
            new_string: 'answer = 42',
          },
        },
      ],
    };
  return { text: REPLY };
});
const project = join(mkdtempSync(join(tmpdir(), 'rocky-e2e-project-')), 'app');
mkdirSync(project);
const appFile = join(project, 'app.js');
writeFileSync(appFile, 'const answer = 41;\n');
const shots = process.env['ROCKY_E2E_SCREENSHOTS'];
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

  // M2: project folder, approval mode, approval panel, change card and restore.
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByLabel('專案資料夾').fill(project);
  await page.getByRole('button', { name: '使用這個資料夾' }).click();
  await page.getByText('已設定').waitFor();
  await page.getByLabel('核准模式').selectOption('ask-always');
  await page.getByRole('button', { name: '回到對話' }).click();
  await page.getByRole('button', { name: '新對話' }).click();
  check(
    (await page.getByLabel('核准模式').inputValue()) === 'ask-always',
    'a new conversation starts in the default approval mode',
  );
  await page.getByRole('textbox').fill('請把 41 改成 42');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: '等你核准' });
  await panel.waitFor({ timeout: 20_000 });
  await panel.getByText('Rocky 想修改 app.js').waitFor();
  await panel.locator('.diff-add', { hasText: 'const answer = 42;' }).waitFor();
  check(
    readFileSync(appFile, 'utf8').includes('41'),
    'the approval panel replaces the input box and shows the diff before anything is written',
  );
  if (shots) await page.screenshot({ path: join(shots, 'm2-approval.png') });
  await page.keyboard.press('1');
  await page.getByText('這輪改了 1 個檔案').waitFor({ timeout: 20_000 });
  check(
    readFileSync(appFile, 'utf8') === 'const answer = 42;\n',
    'key 1 approves once and the file is written',
  );
  await page.locator('.tool-card', { hasText: '修改檔案' }).first().waitFor();
  check(true, 'the edit shows as a tool card with a change card for the turn');
  await page.getByRole('button', { name: '看看' }).click();
  await page.locator('.turn-changes .diff-del', { hasText: '41' }).waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'm2-changes.png') });
  await page.getByRole('button', { name: '全部還原' }).click();
  await page.getByRole('button', { name: '確定還原' }).click();
  await page.getByText('已還原 1 個檔案。').waitFor();
  check(
    readFileSync(appFile, 'utf8') === 'const answer = 41;\n',
    'restore all puts the file back',
  );

  await page.getByRole('textbox').fill('再改一次');
  await page.keyboard.press('Enter');
  await panel.waitFor({ timeout: 20_000 });
  await page.keyboard.press('4');
  await page.getByPlaceholder('告訴 Rocky 為什麼').fill('先不要改，請先跑測試');
  await page.keyboard.press('Enter');
  await page
    .locator('.reply', { hasText: '先不要改，請先跑測試' })
    .waitFor({ timeout: 20_000 });
  check(
    readFileSync(appFile, 'utf8').includes('41'),
    'key 4 rejects with a reason, the file is untouched and the reason reaches the model',
  );

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
