# ADR 0036：Rocky 可以用 npm 全域安裝

- 日期：2026-10-12
- 狀態：已採用（套件可以打包、安裝、啟動；還沒有發佈到 npm）；補充 ADR 0004

## 背景

Rocky 只能 `git clone` 後 `npm ci`、`npm start`。擁有者想用一個 npm 指令安裝。原本的做法有四個障礙：

- `package.json` 是 `private`，也沒有 `bin`，裝完沒有指令可以打。
- 伺服器直接用 Node 跑 `.ts`。Node 不會替 `node_modules` 裡的 `.ts` 拿掉型別
  （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），裝成套件就無法啟動。
- `npm start` 每次都先 `vite build`，但 Vite 是 devDependency，使用者安裝時不會裝到。
- `npm install -g` 不看 `package-lock.json`，版本鎖定在使用者那邊失效。

## 決定

1. 套件名稱 `@suckashi/rocky`（`rocky` 在 npm 上很可能已被使用），版本 `0.1.0`，`publishConfig.access = public`。
2. `bin/rocky.js` 是 `rocky` 指令，載入編譯好的 `dist/server/start.js`。
3. 伺服器用 `tsconfig.build.json` 編譯（`npm run build:server`）：沿用 `tsconfig.json`，加上
   `rewriteRelativeImportExtensions`，`src/server` 與 `src/shared` 輸出到 `dist/`。`erasableSyntaxOnly` 早已開著，
   所以編譯只拿掉型別，不改寫程式。`main.ts` 找 `dist/web` 的路徑從 `dist/server/` 算過去不變。
4. `prepare` 跑 `vite build` 與 `build:server`，套件帶著建置好的 `dist/web` 和 `dist/server`。用 `prepare` 不用
   `prepack`：從 Git 打包時 npm（pacote）只跑 `prepare`，`prepack` 不會跑，套件裡就沒有 `dist/`。代價是開發時每次
   `npm ci`／`npm install` 後也會建置一次。
5. `package-lock.json` 改成 `npm-shrinkwrap.json`，並且**要列在 `files` 裡**：npm 11 不會自動把它放進套件。
   `npm ci` 和 `Start-Rocky.ps1` 照常使用它。
6. `files` 放 `bin`、`dist`、`NOTICE`、`THIRD_PARTY_NOTICES.md`、`npm-shrinkwrap.json`（npm 另外自動帶 `LICENSE`、
   README）。`assets/` 已由 Vite 複製進 `dist/web`，不另外放。
7. 開發流程不變：`npm start` 仍直接跑 `src/server/start.ts`。
8. 只有網頁用的依賴（`react`、`react-dom`、`react-markdown`、`lucide-react`、`@copilotkit/react-core`）放在
   devDependencies：網頁在發佈前就建置進 `dist/web`，安裝的人用不到它們。正式依賴從 989 個降到 589 個，
   `node_modules` 從 991 MB 降到 567 MB（`npm ci --omit=dev`，清空快取後 44 秒和 45 秒，時間沒有變）。
   之後新增只有網頁用的套件，也放進 devDependencies。把伺服器整個打包的評估見 ADR 0037。

## shrinkwrap 什麼時候有效

npm 只看 registry 對這個版本標的 `_hasShrinkwrap`，不會自己打開套件找。npmjs.org 在發佈時依套件內容設定它（例如
`@salesforce/cli` 是 `true`，套件裡有 `npm-shrinkwrap.json`）。所以：

- **從 npmjs.org 安裝：** 照 shrinkwrap 安裝。
- **從 `.tgz` 或 Git 安裝：** 沒有這個標記，npm 照 `package.json` 的範圍重新解析，間接依賴會拿到較新的版本。

## Git 直接安裝為什麼失敗

`npm install -g github:Suckashi/Rocky`（試的是 `git+file://`）會失敗，原因在 npm，不在 Rocky：

1. npm 為了準備 Git 套件，會在暫存的 clone 裡另外跑一個 `npm install --force`。
2. 外層的設定以 `npm_config_*` 環境變數傳給它，其中包括 `global=true` 和 `prefix`。
3. 所以這個巢狀的 npm 也在全域模式下執行，操作的是外層正在安裝的那個全域資料夾：它的 log 裡有 838 筆 `REMOVE`、
   0 筆 `ADD`。外層解壓到一半的檔案被刪掉（`TAR_ENTRY_ERROR` lstat ENOENT），`@scarf/scarf` 的資料夾也不見了
   （`spawn sh ENOENT`，exit 254）。
4. 改成 `prepare` 後一樣失敗，只是換成 `vite: not found`（exit 127）：巢狀 npm 沒把依賴裝進 clone。

不是全域模式時沒有這個問題，所以從 Git 安裝要分兩步：

```sh
npm pack github:Suckashi/Rocky
npm install -g ./suckashi-rocky-0.1.0.tgz
```

## 驗證了什麼（雲端 Linux，Node 24.21.0，npm 11.19.0）

| 項目                                                                                                              | 結果                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm pack`                                                                                                        | ✅ 554 個檔案，含 `npm-shrinkwrap.json`                                       |
| `npm install -g` 本機 `.tgz`                                                                                      | ✅ exit 0；沒有 vite、typescript；**沒有**照 shrinkwrap（57 個版本不同）      |
| 發佈到本機 verdaccio，模擬 npmjs.org 標上 `_hasShrinkwrap`，再 `npm install -g`                                   | ✅ exit 0；1027 個鎖定套件版本全部相同；另外多裝 8 個 dev 套件（見限制）      |
| 同上但沒有標記                                                                                                    | 和 `.tgz` 一樣，沒有照 shrinkwrap                                             |
| `npm install -g git+file://…`（`prepack`／`prepare` 各一次）                                                      | ❌ exit 254／127，原因見上                                                    |
| `npm pack git+file://…`（`prepare`）再 `npm install -g` 產生的 `.tgz`                                             | ✅ exit 0；`dist/` 在；用 `prepack` 時套件只有 7 個檔案                       |
| 用裝好的 `rocky` 啟動（`.tgz`、Git 打包、verdaccio 三種，`ROCKY_DATA_DIR`、`ROCKY_PORT`、`ROCKY_OPEN_BROWSER=0`） | ✅ 印出登入連結；`/` 回 200（`.tgz` 那次也查了 `/roko/...`）                  |
| 全域安裝時 Scarf 的安裝遙測（`SCARF_VERBOSE=true`、新的 `TMPDIR`）                                                | ✅ 回報 `Scarf has been disabled via a package.json in the dependency chain.` |
| `npm ci`（含 `prepare` 建置）                                                                                     | ✅ 53 秒，產生 `dist/`                                                        |
| `npm run check`                                                                                                   | ✅ exit 0（327 通過、5 略過）                                                 |

verdaccio 只在本機 127.0.0.1 執行，沒有發佈到 npmjs.org。

## 限制

- **還沒發佈。** 發佈到 npm 屬於部署，要擁有者明確同意。發佈後要用 `npm view @suckashi/rocky _hasShrinkwrap`
  確認是 `true`。
- **從 `.tgz` 或 Git 安裝時版本沒有鎖定**（見上）。
- 照 shrinkwrap 安裝時會多裝 `vitest` 等 8 個 dev 套件：`@copilotkit/channels-core` 把 `vitest` 列為可選的 peer
  dependency。執行時不會載入它們。
- 沒有在 Windows 上驗證全域安裝與 `rocky.cmd` 啟動，也沒有跑改過鎖定檔名稱的 `Start-Rocky.ps1`；也沒有在全域安裝的
  版本上跑 e2e 或模型。
- 使用者那邊 `engine-strict` 不生效（`.npmrc` 不隨套件），Node 版本不對只會警告；啟動時 Node 24 才有的功能會直接失敗。
- 第一次安裝仍然很大（約 1000 個套件），見 ADR 0004。
