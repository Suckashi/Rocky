# ADR 0003：外部 agent 執行路徑（S1 spike 結果）

- 日期：2026-10-05
- 狀態：已採用（原生 Windows 在 CI 上以假模型驗證；擁有者電腦上的真實使用待確認）
- 程式：`spikes/s1-acp/`；測試：`tests/spikes/s1-acp.test.ts`

## 決定

Rocky 用 `@agentclientprotocol/sdk` 1.7.0 的 `ClientSideConnection` 直接啟動原生 Windows 的 `opencode acp`（OpenCode 1.18.34），
**不需要 WSL 備案**。Rocky 這一側固定做這幾件事：

- 啟動：找到真正的 `opencode.exe`（npm 全域安裝的 `.cmd` shim 旁邊的 `node_modules/opencode-ai/bin/opencode.exe`），用 argv 啟動，不經 shell。
- 環境：只傳白名單裡的變數（PATH、SystemRoot、TEMP 等），Rocky 的 token 不會傳過去；OpenCode 的 config、data、cache 放在 Rocky 指定的資料夾。
- 設定：用 `OPENCODE_CONFIG_CONTENT` 傳入 Rocky 的設定（模型走 OpenAI 相容端點；`permission` 除了讀取類以外一律 `ask`），
  並用環境變數關掉自動更新、模型清單下載、分享、LSP 下載、預設外掛、讀取 Claude Code 設定，以及**專案自帶的 `opencode.json`**。
- 核准：每個 `session/request_permission` 都送進 Rocky 的關卡，雜湊綁定 `kind`、diff 或指令、`rawInput` 與 session 的 cwd；
  只回 `allow_once` 或 `reject_once`，從不選 `allow_always`。
- 驗證：OpenCode 在 git worktree 裡工作；結束後 Rocky 自己看 `git status`，每個改動的檔案都必須和核准的 `newText` 一模一樣，並自己重跑測試。

## 驗證了什麼

### 假模型（127.0.0.1 上的腳本化 OpenAI 相容伺服器，真的 OpenCode 執行檔）

| 項目                                                                                         | Ubuntu | Windows（CI） |
| -------------------------------------------------------------------------------------------- | ------ | ------------- |
| 改檔、建檔、執行指令前都會問 Rocky；repo 自帶 `{"permission":{"*":"allow"}}` 也一樣要問      | ✅     | ✅            |
| 只回 `allow_once`／`reject_once`／`cancelled`（OpenCode 每次都有提供 `allow_always`）        | ✅     | ✅            |
| worktree 的改動和核准的 diff 一字不差，含中文與 CRLF                                         | ✅     | ✅            |
| 拒絕：檔案沒有建立；這一輪結束（`end_turn`）；下一個 prompt 帶原因，模型看得到被拒的工具結果 | ✅     | ✅            |
| 核准的指令在子程序裡拿不到 Rocky 的 token（`process.env.ROCKY_API_TOKEN` 是 `undefined`）    | ✅     | ✅            |
| 權限請求還開著時取消：請求回 `cancelled`，prompt 回 `stopReason: cancelled`，檔案沒變        | ✅     | ✅            |
| 續接：關掉程序、用同一個資料夾重開，`loadSession` 會重播歷史，新的 prompt 記得前文           | ✅     | ✅            |
| prompt 回應有 token 用量與 `cachedReadTokens`                                                | ✅     | ✅            |

### 真實模型（Command Code，`deepseek/deepseek-v4-flash`，雲端 Linux，**自動核准**）

任務：小 repo 裡 `average()` 除錯，修好後跑 `node --test`。

- 25.9 秒，`end_turn`；OpenCode 問了 3 次（`ls -la`、改 `math.js`、`node --test`），Rocky 都回 `allow_once`。
- 只改了 `math.js`，和核准的 diff 一致；Rocky 自己在 worktree 重跑 `node --test`：通過。
- 用量：`inputTokens 208, outputTokens 28, cachedReadTokens 8064`（見發現 6）。
- OpenCode 聯絡過的主機：`registry.npmjs.org`、`api.commandcode.ai`。

## 重要發現

1. **拒絕無法附原因，而且 OpenCode 預設在拒絕後直接結束這一輪。** ACP 的回應只有選項，沒有文字；
   OpenCode 給模型的是固定訊息 “The user rejected permission to use this specific tool call.”。
   做法：Rocky 在下一個 prompt 帶上原因與「換個做法」。（`experimental.continue_loop_on_deny` 可以讓它繼續跑，但仍然沒有原因，所以不用。）
2. **指令的權限請求沒有 cwd**，`rawInput` 只有 `command`。Rocky 把 session 的 cwd 放進雜湊；指令自己帶 `workdir` 時也會在 `rawInput` 裡。
3. **改檔的權限請求帶完整檔案內容**（`content` 裡的 diff 是整個檔案的 `oldText`／`newText`，`rawInput.diff` 是 unified diff），
   可以直接用來顯示、綁雜湊、事後比對。`write` 工具的 `kind` 也是 `edit`。
4. **OpenCode 不理會 SIGTERM。** 有一次 `kill()` 之後超過 400 秒都沒結束。關閉要先關 stdin（OpenCode 會自己結束），再 SIGTERM，最後強制終止，每步都有時限。
   M3 在 Windows 上還要用 Job Object 管住它的子行程。
5. **OpenCode 不是完全離線。** 即使關掉所有能關的功能：
   - 每次啟動都會到 `registry.npmjs.org` 查 `@opencode-ai/plugin`；
   - PATH 上沒有 `rg` 時，會從 GitHub 下載 ripgrep 15.1.0（Windows runner 上是 `github.com`、`release-assets.githubusercontent.com`）。
     Rocky 要在 UI 上說明這兩件事；之後可以考慮由 Rocky 提供 `rg`，避免下載。
6. **`PromptResponse.usage` 看起來只算最後一次模型呼叫**（真實模型那次 `inputTokens` 只有 208），要算整輪總量得另外累加。
7. 啟動到 session 建好約 5 秒（雲端 Linux）。

## 執行紀錄

| 平台                          | 指令                                                    | 結果                                                                                                |
| ----------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0      | `ROCKY_REQUIRE_OPENCODE=1 npm run check`                | exit 0；22 個測試通過（S1 9 個）                                                                    |
| GitHub Actions windows-latest | `npm install -g opencode-ai@1.18.34` 後 `npm run check` | 第一次：S1 功能測試 8 個通過，主機檢查失敗（ripgrep 下載，見發現 5）；修正後通過（run 37312826744） |
| GitHub Actions ubuntu-latest  | 同上                                                    | 通過                                                                                                |
| 雲端 Linux，Node 24.21.0      | `node spikes/s1-acp/live.ts`（Command Code，自動核准）  | 第一次 exit 124：關閉時卡住（發現 4）；修正後 exit 0，結果如上                                      |

## 還沒驗證的（限制）

- **擁有者的 Windows 上還沒跑過真實模型**：CI 的 Windows 只用假模型。請照 `spikes/s1-acp/README.md` 在你的電腦上跑一次 `live.ts`（手動核准）。
- 沒測 OpenCode 的登入（`opencode auth login`）：Rocky 直接用自己的模型設定，不需要它。
- 沒測 Windows 上 Job Object、`.cmd` 以外的安裝方式（scoop、choco）與 junction 路徑。
- 取消只測了「權限請求還開著時」；模型串流到一半時取消還沒測。
- 子代理（OpenCode 的 `task`）、MCP 轉交、`resumeSession`（不重播歷史）還沒測。
