// End-to-end check of delegation in a real browser: Rocky hands a bug fix to a real
// `opencode acp` (scripted model), the user approves the job, reviews it on the job page
// and applies it. Needs OpenCode installed. Not part of CI. Run: npm run test:e2e:jobs
//   ROCKY_E2E_BROWSER  path to a Chromium-based browser; default: the system Edge (msedge)
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { findOpenCode } from '../src/server/external/opencode.ts';
import {
  startFakeOpenAI,
  type ChatRequestMessage,
} from '../spikes/s2-agent/fake-openai.ts';

const port = 4380 + Math.floor(Math.random() * 9);
const root = join(import.meta.dirname, '..');
const shots = process.env['ROCKY_E2E_SCREENSHOTS'];
const BUGGY = 'export function add(a, b) {\n  return a - b;\n}\n';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`e2e failed: ${message}`);
  console.log(`ok - ${message}`);
}

if (!findOpenCode()) {
  console.error(
    'OpenCode not found (npm i -g opencode-ai, or set ROCKY_OPENCODE_BIN).',
  );
  process.exit(2);
}

const base = mkdtempSync(join(tmpdir(), 'rocky-e2e-jobs-'));
const project = join(base, 'calc');
mkdirSync(project);
writeFileSync(join(project, 'math.js'), BUGGY);
writeFileSync(
  join(project, 'math.test.js'),
  "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add } from './math.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n",
);
writeFileSync(
  join(project, 'package.json'),
  JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
);
for (const args of [
  ['init', '-q'],
  ['config', 'user.email', 'e2e@example.com'],
  ['config', 'user.name', 'e2e'],
  ['add', '-A'],
  ['commit', '-q', '-m', 'init'],
]) {
  execFileSync('git', ['-C', project, ...args]);
}

const text = (m: ChatRequestMessage | undefined) =>
  JSON.stringify(m?.content ?? '');
let worktree = '';
const newestWorktree = () => {
  const dir = join(base, 'data', 'worktrees');
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
};
const fake = await startFakeOpenAI((messages) => {
  const system = text(messages[0]);
  if (system.includes('title generator')) return { text: 'Job' };
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (system.includes('You are Rocky')) {
    // Only this turn's tool results count (earlier turns delegated too).
    const turn = messages.slice(messages.lastIndexOf(lastUser!) + 1);
    if (turn.some((m) => m.role === 'tool'))
      return { text: '已排入背景，可以繼續聊天；結果請到工作頁查看。' };
    return {
      toolCalls: [
        {
          name: 'delegate_to_opencode',
          args: {
            title: '修正 add',
            task: 'Fix add() in math.js so the tests pass.',
          },
        },
      ],
    };
  }
  // OpenCode's model: edit math.js in the job's worktree, run the tests, summarise.
  // The job running now has the newest worktree.
  worktree = newestWorktree();
  const step = Math.floor(
    (messages.length - 1 - messages.lastIndexOf(lastUser!)) / 2,
  );
  if (step === 0)
    return {
      toolCalls: [
        {
          name: 'edit',
          args: {
            filePath: join(worktree, 'math.js'),
            oldString: '  return a - b;',
            newString: '  return a + b;',
          },
        },
      ],
    };
  if (step === 1)
    return {
      toolCalls: [
        {
          name: 'bash',
          args: { command: 'node --test', description: 'Run tests' },
        },
      ],
    };
  return { text: '已修正 add，測試通過。' };
});

const server = spawn(
  process.execPath,
  [join(root, 'src', 'server', 'start.ts')],
  {
    env: {
      ...process.env,
      ROCKY_DATA_DIR: join(base, 'data'),
      ROCKY_PORT: String(port),
      ROCKY_OPEN_BROWSER: '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
const url = await new Promise<string>((resolve, reject) => {
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (out: string) => {
    const match = /(http:\/\/127\.0\.0\.1:\d+\/\?code=\S+)/.exec(out);
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
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  current = page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page
    .getByText('選好模型就能開始')
    .waitFor({ timeout: 15_000 })
    .catch(() => {
      throw new Error(`onboarding did not render: ${errors.join(' | ')}`);
    });
  await page.getByLabel('網址').fill(fake.baseURL);
  await page.getByRole('combobox', { name: '模型' }).fill('fake-model');
  await page.getByRole('button', { name: '儲存' }).first().click();
  await page.getByLabel('專案資料夾').fill(project);
  await page.getByRole('button', { name: '使用這個資料夾' }).click();
  await page.getByText('已設定').waitFor();
  await page.getByRole('button', { name: '開始和 Roko 對話' }).click();

  await page.getByRole('textbox').fill('請交給 OpenCode 修好 add');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: '等你核准' });
  await panel
    .getByText('Rocky 想把工作交給 OpenCode：修正 add')
    .waitFor({ timeout: 30_000 });
  check(true, 'starting a job asks first, in plain language');
  if (shots) await page.screenshot({ path: join(shots, 'm3-delegate.png') });
  await page.keyboard.press('1');
  // The turn ends at once; the job runs in the background.
  await page.getByText('已排入背景').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '送出' }).waitFor();
  check(
    true,
    'the conversation is free again while the job runs in the background',
  );
  await page.getByRole('link', { name: '查看工作' }).click();
  await page
    .locator('.job-head .badge', { hasText: '已驗證' })
    .waitFor({ timeout: 120_000 });
  check(
    readFileSync(join(project, 'math.js'), 'utf8') === BUGGY,
    'OpenCode worked in a worktree; the project is untouched',
  );
  await page.getByText('每個改動都和核准的內容一致。').waitFor();
  await page.getByText('Rocky 執行 npm test：結束代碼 0').waitFor();
  check(true, "the job page shows Rocky's verification and its own test run");
  if (shots)
    await page.screenshot({ path: join(shots, 'm3-job.png'), fullPage: true });
  await page.getByRole('button', { name: '套用到專案' }).click();
  await page.getByRole('button', { name: '確定套用' }).click();
  await page.getByText('已套用 1 個檔案。').waitFor();
  check(
    readFileSync(join(project, 'math.js'), 'utf8').includes('a + b'),
    'applying copies the verified change into the project',
  );
  // A second job in ask-always mode: its edit asks on the job page, with a badge on the rail.
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '對話' }).click();
  await page.getByLabel('核准模式').selectOption('ask-always');
  await page.getByRole('textbox').fill('請再交給 OpenCode 修一次');
  await page.keyboard.press('Enter');
  await panel.waitFor({ timeout: 30_000 });
  await page.keyboard.press('1');
  await page
    .locator('.reply', { hasText: '已排入背景' })
    .nth(1)
    .waitFor({ timeout: 30_000 });
  await page
    .getByRole('button', { name: '工作（1 件等你核准）' })
    .waitFor({ timeout: 60_000 });
  check(true, 'the rail shows that a background job is waiting for approval');
  await page.getByRole('link', { name: '查看工作' }).last().click();
  await panel.getByText('OpenCode 想修改 math.js').waitFor({ timeout: 30_000 });
  if (shots)
    await page.screenshot({ path: join(shots, 'm6-job-approval.png') });
  // In ask-always every action asks (the edit, then OpenCode running the tests): approve each.
  const finished = page.locator('.job-head .badge', {
    hasText: /已驗證|有問題/,
  });
  for (let i = 0; i < 5 && !(await finished.isVisible()); i++) {
    const option = panel.getByRole('option').first();
    await Promise.race([
      option.waitFor({ timeout: 60_000 }),
      finished.waitFor({ timeout: 60_000 }),
    ]);
    if (await option.isVisible()) {
      const title = await panel.locator('strong').first().textContent();
      await page.keyboard.press('1');
      await panel
        .locator('strong', { hasText: title ?? '' })
        .waitFor({ state: 'detached', timeout: 30_000 })
        .catch(() => undefined);
    }
  }
  await finished.waitFor({ timeout: 120_000 });
  check(true, "the background job's approval is answered on the job page");
  const before = readFileSync(join(project, 'math.js'), 'utf8');
  await page.getByRole('button', { name: '捨棄' }).click();
  await page.locator('.job-head .badge', { hasText: '已捨棄' }).waitFor();
  check(
    readFileSync(join(project, 'math.js'), 'utf8') === before,
    'discarding a job leaves the project untouched',
  );
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} catch (error) {
  failed = true;
  if (shots && current)
    await current.screenshot({
      path: join(shots, 'm3-failure.png'),
      fullPage: true,
    });
  console.error(error);
} finally {
  await browser.close();
  server.kill('SIGINT');
  await fake.close();
}
process.exit(failed ? 1 : 0);
