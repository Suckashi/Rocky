// End-to-end check of the chat UI in a real browser against a scripted model.
// Not part of CI (too heavy for every push). Run: npm run test:e2e
//   ROCKY_E2E_BROWSER  path to a Chromium-based browser; default: the system Edge (msedge)
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startFakeOpenAI } from '../tests/fixtures/fake-openai.ts';

const REPLY = '你好！我是 Rocky。這是**測試回覆**。';
const port = 4390 + Math.floor(Math.random() * 9);
const root = join(import.meta.dirname, '..');

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`e2e failed: ${message}`);
  console.log(`ok - ${message}`);
}

// Asked to change something, the model edits /AGENTS.md (protected, so it asks in the default
// mode); once a tool answered, it reports back.
const fake = await startFakeOpenAI((messages) => {
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const results = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  // Two questions in one turn: 41 → 42, then back to 41.
  if (
    JSON.stringify(messages[lastUser]?.content ?? '').includes('來回') &&
    results.length < 2
  )
    return {
      toolCalls: [
        {
          name: 'edit_file',
          args: {
            file_path: '/AGENTS.md',
            old_string: results.length === 0 ? 'answer = 41' : 'answer = 42',
            new_string: results.length === 0 ? 'answer = 42' : 'answer = 41',
          },
        },
      ],
    };
  if (results.length > 0)
    return { text: `已處理。工具回覆：${String(results.at(-1)!.content)}` };
  const said = JSON.stringify(messages[lastUser]?.content ?? '');
  if (said.includes('記住'))
    return {
      toolCalls: [
        {
          name: 'remember',
          args: { title: '部署環境', content: '正式環境叫「藍鯨」。' },
        },
      ],
    };
  if (said.includes('規劃'))
    return {
      toolCalls: [
        {
          name: 'propose_plan',
          args: {
            title: '整理專案',
            options: [
              {
                title: '只整理 app.js',
                summary: '最小改動',
                steps: ['改 app.js'],
              },
              {
                title: '整理並檢查',
                summary: '改完跑檢查',
                steps: ['改 app.js', '跑檢查'],
              },
            ],
          },
        },
      ],
    };
  if (said.includes('簡報'))
    return {
      toolCalls: [
        {
          name: 'create_document',
          args: {
            file_path: '/.github/簡報.pptx',
            markdown:
              '# 季度簡報\n\n- 營收成長\n- 成本下降\n\n## 下一步\n\n繼續努力',
          },
        },
      ],
    };
  if (said.includes('檢查'))
    return {
      toolCalls: [
        { name: 'run_command', args: { argv: ['git', 'reset', '--hard'] } },
      ],
    };
  // A command that outlives its timeout: its outcome is unknown.
  if (said.includes('等很久'))
    return {
      toolCalls: [
        {
          name: 'run_command',
          args: {
            argv: [process.execPath, '-e', 'setTimeout(() => {}, 20000)'],
            timeout_seconds: 1,
          },
        },
      ],
    };
  if (said.includes('改'))
    return {
      toolCalls: [
        {
          name: 'edit_file',
          args: {
            file_path: '/AGENTS.md',
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
const appFile = join(project, 'AGENTS.md');
writeFileSync(appFile, 'const answer = 41;\n');
const shots = process.env['ROCKY_E2E_SCREENSHOTS'];
// A skill installed by hand, as a user would.
const dataDir = mkdtempSync(join(tmpdir(), 'rocky-e2e-'));
mkdirSync(join(dataDir, 'skills', 'changelog'), { recursive: true });
writeFileSync(
  join(dataDir, 'skills', 'changelog', 'SKILL.md'),
  '---\nname: 更新紀錄\ndescription: 用繁體中文寫 CHANGELOG\n---\n\n內容\n',
);
const server = spawn(
  process.execPath,
  [join(root, 'src', 'server', 'start.ts')],
  {
    env: {
      ...process.env,
      ROCKY_DATA_DIR: dataDir,
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
let current: Page | undefined;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page: Page = await context.newPage();
  current = page;
  const errors: string[] = [];
  /** Errors a step causes on purpose (a refused run, a request cut off by a reload). */
  let expected: RegExp | undefined;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The browser logs every 4xx; these are the answers to what this test sends on purpose.
    if (
      message.type() === 'error' &&
      !/status of (400|413)/.test(message.text()) &&
      !expected?.test(message.text())
    )
      errors.push(message.text());
  });

  await page.goto(url);
  await page.getByText('選好模型就能開始').waitFor();
  check(true, 'onboarding shows in Traditional Chinese by default');
  await page.getByLabel('網址').fill(fake.baseURL);
  await page.getByRole('combobox', { name: '模型' }).fill('fake-model');
  // One action on the first-run page: starting saves the model.
  await page.getByRole('button', { name: '開始和 Roko 對話' }).click();
  await page.getByText('選好模型就能開始').waitFor({ state: 'detached' });

  const box = page.getByRole('textbox');
  await page.locator('.empty .roko').waitFor();
  await box.fill('你好，請自我介紹');
  // Roko reads along: typing turns its gaze (the look rows) towards the words.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll<HTMLElement>('.roko')].some((roko) =>
        /roko-row-(9|10)\./.test(roko.style.backgroundImage),
      ),
    undefined,
    { timeout: 5_000 },
  );
  check(true, 'Roko looks towards the words while the user types');
  await page.keyboard.press('Enter');
  await page.getByText('測試回覆').waitFor({ timeout: 20_000 });
  check(true, 'a Chinese message gets a streamed reply rendered as Markdown');
  await page.getByText('這輪完成了').waitFor();
  check(true, 'Roko shows the done state after a turn finishes');
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
  // Appearance: dark is applied at once and kept across a reload; system goes back.
  await page.getByRole('radio', { name: '深色' }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset['theme'] === 'dark',
  );
  const darkBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  await page.reload();
  await page.getByRole('button', { name: '設定' }).click();
  check(
    darkBg === 'rgb(21, 18, 15)' &&
      (await page.evaluate(() => document.documentElement.dataset['theme'])) ===
        'dark',
    'the dark theme applies at once and is kept after a reload',
  );
  await page.getByRole('radio', { name: '跟隨系統' }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset['theme'] === undefined,
  );
  await page.getByLabel('核准模式').selectOption('hands-off');
  await page.getByLabel('核准模式').selectOption('ask-when-needed');
  await page.getByRole('button', { name: '回到對話' }).click();
  await page.getByRole('button', { name: '新對話' }).click();
  check(
    (await page.getByLabel('核准模式').inputValue()) === 'ask-when-needed',
    'the conversation shows the approval mode chosen in Settings',
  );
  await page.getByRole('textbox').fill('請把 41 改成 42');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: '等你核准' });
  await panel.waitFor({ timeout: 20_000 });
  await panel.getByText('Roko 想修改 AGENTS.md').waitFor();
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
  await page.getByRole('button', { name: '查看變更' }).click();
  await page.locator('.turn-changes .diff-del', { hasText: '41' }).waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'm2-changes.png') });
  await page.getByRole('button', { name: '全部還原' }).click();
  await page.getByRole('button', { name: '確定還原' }).click();
  await page.getByText('已還原 1 個檔案。').waitFor();
  check(
    readFileSync(appFile, 'utf8') === 'const answer = 41;\n',
    'restore all puts the file back',
  );
  // The restore can be undone; then one file restores from its own row.
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await page.getByText('已復原，檔案回到這輪改完的樣子。').waitFor();
  check(
    readFileSync(appFile, 'utf8') === 'const answer = 42;\n',
    'undo after a restore writes back what the turn left',
  );
  await page.getByRole('button', { name: '查看變更' }).click();
  await page.getByRole('button', { name: '還原這個檔案' }).click();
  await page.getByText('已還原 AGENTS.md。').waitFor();
  check(
    readFileSync(appFile, 'utf8') === 'const answer = 41;\n',
    'one file restores from its own row',
  );

  // Enter on a focused control does what that control says, never "Allow once".
  await page.getByRole('textbox').fill('用鍵盤再改');
  await page.keyboard.press('Enter');
  await panel.waitFor({ timeout: 20_000 });
  // A protected file: nothing is preselected, so a bare Enter approves nothing.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check(
    (await panel.count()) === 1 &&
      (await panel.locator('button.selected').count()) === 0 &&
      readFileSync(appFile, 'utf8').includes('41'),
    'a protected-file approval preselects nothing; Enter alone approves nothing',
  );
  await panel.getByRole('button', { name: '全螢幕預覽' }).focus();
  await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: '結束全螢幕' }).waitFor();
  await page.keyboard.press('Escape');
  check(
    readFileSync(appFile, 'utf8').includes('41'),
    'Enter on a focused button in the panel runs that button, not "Allow once"',
  );
  // Arrow keys move focus with the highlight: from option 1 down to "拒絕", then Enter.
  await panel.getByRole('button', { name: /^1 / }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  check(
    (await panel
      .getByRole('button', { name: /^\d 拒絕$/ })
      .evaluate((b) => b === document.activeElement)) &&
      (await panel.locator('button.selected').innerText()).includes('拒絕'),
    'arrow keys move focus and highlight together',
  );
  await page.keyboard.press('Enter');
  await page
    .locator('.reply', { hasText: 'rejected' })
    .first()
    .waitFor({ timeout: 20_000 });
  check(
    readFileSync(appFile, 'utf8').includes('41'),
    'Enter on the option reached with the arrow keys rejects; it never approves',
  );

  await page.getByRole('textbox').fill('再改一次');
  await page.keyboard.press('Enter');
  await panel.waitFor({ timeout: 20_000 });
  await page.keyboard.press('4');
  await page.getByPlaceholder('告訴 Roko 為什麼').fill('先不要改，請先跑測試');
  await page.keyboard.press('Enter');
  await page
    .locator('.reply', { hasText: '先不要改，請先跑測試' })
    .waitFor({ timeout: 20_000 });
  check(
    readFileSync(appFile, 'utf8').includes('41'),
    'key 4 rejects with a reason, the file is untouched and the reason reaches the model',
  );

  // A run the server refuses says why and gives the text back (here: the conversation is
  // too long to send).
  expected = /HTTP 413/;
  await page.route('**/api/copilotkit/**', (route) =>
    route.request().method() === 'POST' &&
    route.request().url().endsWith('/run')
      ? route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: '{"error":"too-large"}',
        })
      : route.fallback(),
  );
  await page.getByRole('textbox').fill('這句送不出去');
  await page.keyboard.press('Enter');
  await page
    .getByRole('alert')
    .filter({ hasText: '這段對話太長，無法再送出' })
    .waitFor({ timeout: 20_000 });
  check(
    (await page.getByRole('textbox').inputValue()) === '這句送不出去' &&
      (await page
        .locator('.bubble.user', { hasText: '這句送不出去' })
        .count()) === 0 &&
      (await page.getByText('這輪完成了').count()) === 0,
    'a refused run says the conversation is too long and gives the text back',
  );
  await page.unroute('**/api/copilotkit/**');
  await page.getByRole('textbox').fill('');
  // A run the server started and then lost keeps the message: the server has it.
  expected = /HTTP|terminated|network|stream/i;
  await page.route('**/api/copilotkit/**', (route) =>
    route.request().method() === 'POST' &&
    route.request().url().endsWith('/run')
      ? route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: 'x', runId: 'cut' })}\n\ndata: {broken\n\n`,
        })
      : route.fallback(),
  );
  await page.getByRole('textbox').fill('這一輪會斷掉');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').waitFor({ timeout: 20_000 });
  check(
    (await page.getByRole('textbox').inputValue()) === '' &&
      (await page
        .locator('.bubble.user', { hasText: '這一輪會斷掉' })
        .count()) === 1,
    'a run that broke after the server took it keeps the message and does not give the text back',
  );
  await page.unroute('**/api/copilotkit/**');
  expected = undefined;

  // Reloading in the middle of a turn: the next question of that turn still shows up.
  expected = /network error/;
  const handled = await page.locator('.reply', { hasText: '已處理' }).count();
  const cardsBefore = await page.locator('.turn-changes').count();
  await page.getByRole('textbox').fill('請來回改兩次');
  await page.keyboard.press('Enter');
  await panel.waitFor({ timeout: 20_000 });
  await page.reload();
  await panel.getByText('Roko 想修改 AGENTS.md').waitFor({ timeout: 20_000 });
  await page.keyboard.press('1');
  await panel
    .locator('.diff-add', { hasText: 'const answer = 41;' })
    .waitFor({ timeout: 20_000 });
  await page.keyboard.press('1');
  await page
    .locator('.reply', { hasText: '已處理' })
    .nth(handled)
    .waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '送出' }).waitFor({ timeout: 20_000 });
  // The turn's change card, so later steps count the cards after it.
  await page
    .locator('.turn-changes')
    .nth(cardsBefore)
    .waitFor({ timeout: 20_000 });
  check(
    readFileSync(appFile, 'utf8') === 'const answer = 41;\n' &&
      (await panel.count()) === 0,
    "after a reload during a turn, the turn's next question shows up and the turn ends",
  );
  expected = undefined;

  // The approval mode is one setting: chosen next to the input box, Settings shows it too.
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/settings/mode')),
    page.getByLabel('核准模式').selectOption('hands-off'),
  ]);
  await page.getByRole('button', { name: '設定' }).click();
  const shown = await page.getByLabel('核准模式').inputValue();
  await page.getByLabel('核准模式').selectOption('ask-when-needed');
  await page.getByRole('button', { name: '回到對話' }).click();
  check(
    shown === 'hands-off',
    'the mode chosen next to the input box is the one Settings shows',
  );

  // A question answered elsewhere (another tab, a restart) gives the input box back.
  // The page sees a question the server no longer has, until it answers it.
  let stale = true;
  await page.route('**/api/approvals/answered-elsewhere', (route) => {
    stale = false;
    return route.fallback();
  });
  await page.route('**/api/threads/*/approvals', (route) =>
    !stale
      ? route.fallback()
      : route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            mode: 'ask-when-needed',
            planning: false,
            pending: [
              {
                id: 'answered-elsewhere',
                threadId: 'x',
                toolCallId: null,
                actor: 'rocky',
                effect: {
                  kind: 'command',
                  argv: ['npm', 'test'],
                  cwd: project,
                },
                contentHash: 'h',
                reason: 'dangerous',
                detail: 'push',
                before: null,
                root: null,
                grant: 'dangerous:push',
                always: ['npm', 'test'],
                createdAt: 0,
              },
            ],
          }),
        }),
  );
  expected = /status of 409/;
  await page.reload();
  await panel.waitFor({ timeout: 20_000 });
  await page.keyboard.press('1');
  await page.getByRole('textbox').waitFor({ timeout: 20_000 });
  expected = undefined;
  check(
    (await page
      .getByRole('alert')
      .filter({ hasText: 'not-pending' })
      .count()) === 0,
    'answering a question that is already gone brings the input box back, without a raw code',
  );
  await page.unroute('**/api/threads/*/approvals');
  await page.unroute('**/api/approvals/answered-elsewhere');

  // Memory: remembered in chat, without a question in the default mode.
  await page.getByRole('textbox').fill('請記住部署環境');
  await page.keyboard.press('Enter');
  await page
    .locator('.reply', { hasText: 'Saved' })
    .waitFor({ timeout: 20_000 });
  check(true, 'remembering saves without asking in the default mode');

  // Documents: the side panel shows how the slides will look, before anything is written.
  const cards = await page.locator('.turn-changes').count();
  const side = page.getByRole('complementary', { name: '預覽' });
  await page.getByRole('textbox').fill('做一份簡報');
  await page.keyboard.press('Enter');
  await panel
    .getByText('Roko 想新增檔案 .github/簡報.pptx')
    .waitFor({ timeout: 20_000 });
  await panel.getByRole('button', { name: '版面預覽' }).click();
  const slides = side.frameLocator('iframe[title="修改後的版面預覽"]');
  await slides.locator('section.slide', { hasText: '季度簡報' }).waitFor();
  check(
    (await slides.locator('section.slide').count()) === 2 &&
      !existsSync(join(project, '.github', '簡報.pptx')) &&
      (await panel.locator('.approval-options > li').count()) === 4,
    'a new deck shows its slides in the side panel before it is written, beside the approval',
  );
  if (shots) await page.screenshot({ path: join(shots, 'm4-preview.png') });
  const before = await side.boundingBox();
  const edge = page.getByRole('separator', { name: /調整預覽寬度/ });
  const grip = (await edge.boundingBox())!;
  await page.mouse.move(grip.x + 4, grip.y + 200);
  await page.mouse.down();
  await page.mouse.move(grip.x - 150, grip.y + 200, { steps: 5 });
  await page.mouse.up();
  check(
    (await side.boundingBox())!.width > before!.width + 100,
    'dragging the panel edge makes it wider',
  );
  await page.keyboard.press('1');
  const change = page.locator('.turn-changes').nth(cards);
  await change.waitFor({ timeout: 20_000 });
  await page
    .locator('.tool-card', { hasText: '簡報.pptx' })
    .last()
    .getByRole('button', { name: '預覽' })
    .click();
  await side
    .frameLocator('iframe')
    .locator('section.slide', { hasText: '下一步' })
    .waitFor();
  await change.getByRole('button', { name: '查看變更' }).click();
  await change.locator('.diff-add', { hasText: '營收成長' }).waitFor();
  check(
    existsSync(join(project, '.github', '簡報.pptx')),
    'the written deck opens from its tool card; the change card diffs its text',
  );

  // Replacing it: before and after side by side, then rejected.
  await page.getByRole('textbox').fill('再做一份簡報');
  await page.keyboard.press('Enter');
  await panel
    .getByText('Roko 想修改 .github/簡報.pptx')
    .waitFor({ timeout: 20_000 });
  await panel.getByRole('button', { name: '版面預覽' }).click();
  await side.getByRole('button', { name: '並排' }).click();
  await side
    .frameLocator('iframe[title="修改前的版面預覽"]')
    .locator('section.slide', { hasText: '季度簡報' })
    .waitFor();
  await side
    .frameLocator('iframe[title="修改後的版面預覽"]')
    .locator('section.slide', { hasText: '季度簡報' })
    .waitFor();
  if (shots)
    await page.screenshot({ path: join(shots, 'm4-side-by-side.png') });
  await page.keyboard.press('3');
  await page
    .locator('.reply', { hasText: 'rejected' })
    .last()
    .waitFor({ timeout: 20_000 });
  await side.getByRole('button', { name: '關閉預覽' }).click();
  check(
    (await side.count()) === 0,
    'an edit compares before and after side by side; the panel closes',
  );

  // An action whose outcome is unknown offers the two buttons; Rocky never redoes it.
  await page.getByRole('textbox').fill('跑一個會等很久的指令');
  await page.keyboard.press('Enter');
  const unknown = page.locator('.unknown-outcome');
  await unknown.waitFor({ timeout: 30_000 });
  await unknown.getByRole('button', { name: '沒成功，再做一次' }).waitFor();
  await unknown.getByRole('button', { name: '我看過了，成功了' }).click();
  await unknown.waitFor({ state: 'detached' });
  check(
    true,
    'a timed-out command shows as unknown and the user can confirm it',
  );

  // "Always allow" saves the rule the panel shows; the same kind of command no longer asks.
  const replies = await page.locator('.reply').count();
  await page.getByRole('textbox').fill('幫我檢查程式碼（第 1 次）');
  await page.keyboard.press('Enter');
  await panel.waitFor({ timeout: 20_000 });
  const always = panel.locator('.approval-options > li').nth(2);
  await always.getByText('git reset *').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'm5-always.png') });
  await page.keyboard.press('3');
  await page.locator('.reply').nth(replies).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '送出' }).waitFor();
  await page.getByRole('textbox').fill('幫我檢查程式碼（第 2 次）');
  await page.keyboard.press('Enter');
  await page
    .locator('.reply')
    .nth(replies + 1)
    .waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '送出' }).waitFor();
  check(
    (await panel.count()) === 0,
    '"always allow" adds the shown rule; the same kind of command no longer asks',
  );

  // Plan mode: turn it on, ask for changes with key 3, then choose option 2 with key 2.
  const planToggle = page.getByRole('button', { name: '規劃', exact: true });
  await planToggle.click();
  check(
    (await planToggle.getAttribute('aria-pressed')) === 'true',
    'the plan toggle turns plan mode on for this conversation',
  );
  for (const [round, keys] of [
    [1, ['3']],
    [2, ['2']],
  ] as const) {
    const before = await page.locator('.reply').count();
    await page.getByRole('textbox').fill(`幫我規劃整理專案（第 ${round} 次）`);
    await page.keyboard.press('Enter');
    await page
      .getByText('Roko 提出 2 個方案：整理專案')
      .waitFor({ timeout: 20_000 });
    if (round === 1) {
      if (shots) await page.screenshot({ path: join(shots, 'm5-plan.png') });
      await page.keyboard.press(keys[0]);
      await page.getByLabel('想怎麼改？（Enter 送出）').fill('請加上測試');
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press(keys[0]);
    }
    await page.locator('.reply').nth(before).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: '送出' }).waitFor();
  }
  await page
    .locator('.reply', { hasText: 'wants changes to the plan: 請加上測試' })
    .waitFor();
  await page
    .locator('.reply', { hasText: 'The user chose option 2: 整理並檢查' })
    .waitFor();
  await page
    .getByRole('button', { name: '規劃', exact: true })
    .and(page.locator('[aria-pressed="false"]'))
    .waitFor();
  check(
    true,
    'plan mode: ask for changes, then choose an option with the number keys; choosing turns plan mode off',
  );

  // Settings: memory, skills and MCP.
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '設定' }).click();
  await page.locator('.memory summary', { hasText: '部署環境' }).click();
  await page.getByText('正式環境叫「藍鯨」。').waitFor();
  await page.getByText('更新紀錄').waitFor();
  check(true, 'settings list the saved memory and the installed skill');
  // Permanent rules: add, refuse a too-broad one, remove.
  await page.getByLabel('指令', { exact: true }).fill('npm test *');
  await page.getByRole('button', { name: '新增規則' }).click();
  await page.locator('.rule-list li', { hasText: 'npm test *' }).waitFor();
  await page.getByLabel('指令', { exact: true }).fill('*');
  await page.getByRole('button', { name: '新增規則' }).click();
  await page.getByText('「允許所有指令」範圍太大，不能新增。').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'm5-rules.png') });
  await page
    .locator('.rule-list li', { hasText: 'npm test *' })
    .getByRole('button', { name: '移除' })
    .click();
  await page
    .locator('.rule-list li', { hasText: 'git reset *' })
    .getByRole('button', { name: '移除' })
    .click();
  await page.getByText('還沒有規則。').waitFor();
  check(true, 'permanent rules can be added, are checked, and removed');
  await page.locator('.mcp-add summary').click();
  await page.getByLabel('名稱（英數字、-、_）').fill('notes');
  await page
    .getByRole('textbox', { name: '程式', exact: true })
    .fill(process.execPath);
  await page
    .getByLabel('參數（一行一個）')
    .fill(join(root, 'tests', 'fixtures', 'mcp-server.ts'));
  await page.locator('.mcp-add').getByRole('button', { name: '儲存' }).click();
  await page
    .locator('.mcp-server .badge', { hasText: '已連線' })
    .waitFor({ timeout: 30_000 });
  await page.getByLabel('echo 的核准方式').selectOption('read-only');
  check(
    (await page.getByLabel('echo 的核准方式').inputValue()) === 'read-only',
    'an MCP server connects, lists its tools, and a tool can be marked read-only',
  );
  if (shots)
    await page.screenshot({
      path: join(shots, 'm5-settings.png'),
      fullPage: true,
    });
  await page
    .locator('.mcp-server')
    .getByRole('button', { name: '移除' })
    .click();
  await page.getByText('還沒有設定 MCP 伺服器。').waitFor();
  await page.locator('.memory').getByRole('button', { name: '刪除' }).click();
  await page.getByText('還沒有記憶。').waitFor();
  check(true, 'removing the MCP server and deleting the memory work');
  await page.getByRole('button', { name: '回到對話' }).click();

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
  if (shots && current)
    await current.screenshot({ path: join(shots, 'e2e-failure.png') });
} finally {
  await browser.close();
  server.kill('SIGINT');
  await fake.close();
}
process.exit(failed ? 1 : 0);
