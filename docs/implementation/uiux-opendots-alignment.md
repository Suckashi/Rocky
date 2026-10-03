# OpenDots UI／UX 對齊 — 2026-10-03

狀態：第一個主對話實作切片，T-019 `in_progress`。不是完整 UI／UX 或第一版功能完成證據。

OpenDots 是 Rocky 的主要 UI／UX 對照基準；Rocky 的原創設計集中在角色、名稱與必要的功能適配。

## 來源與比較方式

固定來源 [OpenDots c2569bb6a13a22e565cf3eb791c62267d06babb1](https://github.com/CopilotKit/OpenDots/tree/c2569bb6a13a22e565cf3eb791c62267d06babb1)，MIT，Copyright (c) Atai Barkai。副本與 Vite reference fixture 在 Windows TEMP 下，未納入 Rocky Git。`THIRD_PARTY_NOTICES.md` 保留完整 MIT notice。

讀取 App、style.css 全部有效 compact overrides 與 media queries、Chat、ChatTranscript、ComputerPanel、ComputerToolCard、PageReviewCard、ResultPane、SpaceNav、SpaceLibrary、SpaceWorkspace、PageDocument、WorkspaceDialog、editor.css／editor 入口及 docs/demos/README.md。實際 cascade 是 style.css 後載入 editor.css，不能採最前面的舊紫色／242px sidebar 數值。

官方 demo 是裁切、放大、加速畫面，只用作可見互動參考，未拿影片全頁做 pixel diff。reference fixture 使用原始兩份樣式與未修改的上游 ChatTranscript 元件，合成 shell 資料與空 transcript；沒有 Intelligence、上游服務、voice call 或假執行結果。它是**重建的 reference fixture**，不能當作上游真實服務執行證據。品牌處留白，其他標籤映射成可比較的 Rocky 資料量。

Windows x64、Node 24.12.0、npm 11.6.4、Chromium 148.0.7778.96、DPR 1、100% zoom、繁中、相同四種 viewport。before 與 after 是隔離 Rocky data root；主流程操作另使用明確 fixture 模式、真實 Deep Agents／MCP／daemon 契約。所有截圖是非私密空資料或合成資料。

## 改動與元件對照

| 上游                              | Rocky 位置                         | 本次修改                                                                                                                     |
| --------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App shell／nav                    | apps/web/src/chrome.tsx            | 48px rail＋220px sidebar、64px topbar、收合導覽；700px 以下 252px drawer、遮罩、Escape、焦點返回／循環                       |
| style.css／editor.css             | apps/web/src/style.css、tokens.css | 取 effective 中性淺色 tokens、尺寸、邊框、字級、22px composer、16px review card；替換舊 CSS，沒有 !important 疊加            |
| Chat／ChatTranscript              | main.tsx、Chrome Transcript        | 空 persona 68px／live 50px、800／850px 外容器、訊息獨立 scroll ownership、離底後新內容入口、Markdown／安全連結與禁止遠端圖片 |
| PageReviewCard                    | main.tsx approval                  | 摘要／影響／內容／操作區；仍送 exact revision＋intentFingerprint，授權由 daemon 決定                                         |
| ComputerToolCard                  | main.tsx Work evidence             | 已確認狀態、按需展開 subagent／工具及最深層 JSON；本輪尚未逐張轉成完整上游工具卡                                             |
| WorkspaceDialog                   | Chrome dialog＋model-settings.tsx  | 模型設定按需開啟，沿用表單／卡片，保存、probe、選取不變；locale 切換使用穩定 panel key                                       |
| ResultPane／ComputerPanel／文件庫 | 待後續 T-020～022                  | 入口如實顯示缺口，本輪未交付右側可用成果／Computer 面板                                                                      |

舊介面的大型 welcome、96px 首屏 avatar、dark amber 全站主題、設定占據 transcript、橫向行動導覽被替換。模型、fixture transport 與 Work call budget 移至 composer popover。composer 停止入口與卡片停止都使用精確 daemon Work 契約；未以串流終止推論完成。

## 比較與尺寸證據

路徑：`docs/implementation/evidence/2026-10-03/uiux/`。

| Viewport | Reference → before → after                                          |
| -------- | ------------------------------------------------------------------- |
| 1440×900 | [comparison-1440.png](evidence/2026-10-03/uiux/comparison-1440.png) |
| 1280×800 | [comparison-1280.png](evidence/2026-10-03/uiux/comparison-1280.png) |
| 390×844  | [comparison-390.png](evidence/2026-10-03/uiux/comparison-390.png)   |
| 320×844  | [comparison-320.png](evidence/2026-10-03/uiux/comparison-320.png)   |

原圖 `reference-*`、`before-*`、`after-*`，量測 `reference-metrics.json`／`before-metrics.json`／`metrics.json`。1440px 實測 rail 48、sidebar 220、topbar 64、empty chat 外容器 800、composer 724×130；reference 與 after 外邊界一致。四尺寸 after 無全頁水平溢出。並排圖為閱讀而縮小，原圖保留完整 viewport。

其他 after：`mobile-drawer.png`、`settings.png`、dark 原圖、`approval.png`、`completed-expanded.png`、`work-mobile.png`。後三者來自 daemon fixture 的實際核准與完成，不是注入 fake success；未與不存在的 before／reference 活動狀態作 pixel diff。

## 必要差異、取代條款與缺口

- Rocky 原創 SVG avatar／mark、單一助手、近期 Work 導覽；沒有新增多聊天室模型。多 Dot、calls、Slack、Intelligence、managed connectors 為 out_of_scope。
- 深色為同結構語意 token 延伸。次要文字 `#686868` 取代參考 `#707070`，通過所有 text／muted／accent／error 在 canvas／surface／raised 上 4.5:1 契約；保留可見焦點，未照搬上游 textarea outline:none。
- 模型／budget／明確 fixture 工具列為 Rocky 必要適配；沒有加入未支援附件或 voice 假按鈕。fixture 勾選才可走合成模型模式。
- 已局部修正 Greenfield R-007／R-052／T-019、Bot B3、DECISIONS 及 plan 的 UI 決策。取代「只少量借用」「不複製版面 CSS」「必須不同布局」與舊全站琥珀配色／排版數值，保留產品、安全和 greenfield 邊界。
- 尚未完整對齊：工具卡／成果卡／工作詳情右側 pane、library／document／Computer、Skills／Learning／完整 MCP settings。這些仍是功能缺口，入口文字不代表完成。
- 待驗：真正增量模型串流與停止、長歷史的 scroll-follow 動態驗證、真外部服務、browser 接管、完整重連故障、全部 loading／error 狀態、長檔名／文件 preview。Ubuntu 與乾淨 browser egress 保留既有阻塞；未再次反覆排查。

## 驗證

實際命令、exit code 與限制記於 [verification.json](evidence/2026-10-03/uiux/verification.json)。新增 alignment.spec.ts 實測四尺寸固定 chrome、composer 可見、drawer 焦點、收合布局、dialog Escape、深色及 reduced motion。既有 functional e2e 保留核准、停止、model usage、permission revoke、reconcile 等結果斷言，只調整新導覽入口。全域 AT 不因本切片改成 passed。

## 後續串流與重連切片

Source 04e1e94436e98b24cd6ac72b6c802fea008c2477：增量 provider SSE、AG-UI 對應事件、共用 Rocky adapter、重連、串流停止已在 local provider fixture 驗證。新增證據 [streaming/verification.json](evidence/2026-10-03/streaming/verification.json) 與 1440／390px 串流截圖；舊切片的「尚無串流」描述只適用原 cb54e75 baseline。真實外部模型／完整 Message history 與長歷史 scroll 動態驗證仍 not_run／未完成。

## Persistent history follow-up

Commit 0ad6624 connects immutable conversation history to the common Rocky adapter. Earlier-history control uses the same neutral12px typography, semantic surface/border and9px secondary-action radius; it is a necessary Rocky paging adaptation. Keyboard completion focuses the transcript with a2px semantic focus outline; this accessibility difference is deliberate. Native tools report failed results separately; Work terminal states remain daemon-authoritative.

History fixture shots: [page](evidence/2026-10-03/history-ui/history-page-1440.png), [desktop](evidence/2026-10-03/history-ui/history-1440.png), [320px](evidence/2026-10-03/history-ui/history-320.png). These are explicitly routed visual fixture/interaction evidence, not upstream service evidence or matched pixel comparisons. Isolated fixture SSE closes and displays the truthful offline state. Real local provider SSE separately verifies preserved upward scroll and the new-content action. Commands/counts/limitations: [verification](evidence/2026-10-03/history-ui/verification.json). The earlier reference→before→after empty-shell comparisons remain the high-fidelity geometry evidence; full populated reference comparison and outstanding panels/modules remain incomplete.

## Steering integration (1350956)

Added Rocky-only WorkSteering inside the existing collapsed Work detail, using neutral form/card tokens and shared daemon-event adapter. OpenDots has no identical receipt contract; this necessary adaptation distinguishes accepted/applied/not_applied and warns that already-running effects are not revoked. No new polling source or synthetic production progress. Actual loopback provider/native boundary browser flow and mobile reload pass. [Accepted Work capture](evidence/2026-10-03/steering/accepted-work-1440.png), [applied capture](evidence/2026-10-03/steering/applied-work-1440.png), [390px reload capture](evidence/2026-10-03/steering/applied-work-390.png). These element captures may exceed viewport height; no fresh reference/before/after comparison is claimed. Full steering dark/English/reduced-motion and320/1280 checks remain not_run. [Evidence](evidence/2026-10-03/steering/verification.json).
