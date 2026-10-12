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
4. `prepack` 跑 `vite build` 與 `build:server`，套件帶著建置好的 `dist/web` 和 `dist/server`；`files` 只放
   `bin`、`dist`、`NOTICE`、`THIRD_PARTY_NOTICES.md`（npm 另外自動帶 `LICENSE`、README）。`assets/` 已由 Vite 複製進
   `dist/web`，不另外放。
5. `package-lock.json` 改成 `npm-shrinkwrap.json`。它會隨套件發佈，`npm install -g` 也照它安裝；`npm ci` 和
   `Start-Rocky.ps1` 照常使用它。
6. 開發流程不變：`npm start` 仍直接跑 `src/server/start.ts`。

## 驗證了什麼（雲端 Linux，Node 24.21.0，npm 11.19.0）

| 項目                                                                                 | 結果                                                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `npm pack`                                                                           | ✅ 553 個檔案，壓縮後 7.5 MB，解開 20.7 MB                                    |
| `npm install -g --prefix <暫存> <tgz>`                                               | ✅ exit 0；沒有裝到 vite、typescript；版本與鎖定檔一致                        |
| 用裝好的 `rocky` 啟動（`ROCKY_DATA_DIR`、`ROCKY_PORT=4399`、`ROCKY_OPEN_BROWSER=0`） | ✅ 印出登入連結；`/` 與 `/roko/...` 回 200；資料寫在資料資料夾                |
| 全域安裝時 Scarf 的安裝遙測（`SCARF_VERBOSE=true`、新的 `TMPDIR`）                   | ✅ 回報 `Scarf has been disabled via a package.json in the dependency chain.` |
| `npm run check`                                                                      | ✅ exit 0（327 通過、5 略過）                                                 |

## 限制

- **還沒發佈。** 發佈到 npm 屬於部署，要擁有者明確同意；在那之前只能從 `npm pack` 產生的 `.tgz` 安裝。
- 沒有在 Windows 上驗證全域安裝與 `rocky.cmd` 啟動；也沒有在全域安裝的版本上跑 e2e 或模型。
- 使用者那邊 `engine-strict` 不生效（`.npmrc` 不隨套件），Node 版本不對只會警告；啟動時 Node 24 才有的功能會直接失敗。
- 第一次安裝仍然很大（約 1000 個套件），見 ADR 0004。
