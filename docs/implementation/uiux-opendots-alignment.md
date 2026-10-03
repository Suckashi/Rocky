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

## Explicit retry integration (c533a58)

WorkRetry maps Rocky-only review/confirm/new-Work semantics into the existing collapsed conversation detail using reference-aligned neutral form/button tokens. Daemon receipts remain authority; unknown is visibly blocked, confirmed succeeded says use existing result, and the new card identifies new execution. Stable UUID and shared events preserve existing adapter architecture. Actual browser checks at1440x900 and320x844 verify reload, keyboard review and create control above composer; no horizontal overflow. [Desktop review](evidence/2026-10-03/retry/review-1440.png), [mobile focus](evidence/2026-10-03/retry/mobile-320.png), [commands](evidence/2026-10-03/retry/verification.json). These are actual local fixture screens, not a new reference/before/after visual fidelity comparison. Dark/English/reduced-motion and1280/390 retry-specific checks remain not_run.

## MCP configuration settings (c9d8d4e)

McpSettings uses the existing reference-aligned WorkspaceDialog, typography/borders/focus and neutral form tokens; no separate dashboard. Configured/disabled states are truthful, save does not connect. Advanced JSON editing is implemented; a structured per-server editor and lifecycle controls remain a gap. Scoped composer textarea CSS prevents interference with settings and steering. Actual four-width browser checks and steering regression pass; [1440 screenshot](evidence/2026-10-03/mcp-registry/settings-1440.png), [1280](evidence/2026-10-03/mcp-registry/settings-1280.png), [390](evidence/2026-10-03/mcp-registry/settings-390.png), [320](evidence/2026-10-03/mcp-registry/settings-320.png). Save focus and no page horizontal overflow checked. [Evidence](evidence/2026-10-03/mcp-registry/verification.json). No new reference/before/after fidelity comparison, dark/English/reduced-motion MCP proof or actual MCP connection claim.

## Actual MCP lifecycle controls (5488911/4b2384c)

Settings now shows authoritative connection status, discovered count and last-confirmed time; Connect/Stop/Refresh and diagnostics use existing reference-aligned cards/buttons/dialog. Ready describes protocol/discovery only and does not imply Work success. Saved-not-connected notice clears on connection request. [1440 ready](evidence/2026-10-03/mcp-lifecycle/ready-1440.png), [390 ready](evidence/2026-10-03/mcp-lifecycle/ready-390.png), [commands](evidence/2026-10-03/mcp-lifecycle/verification.json). Actual local HTTP fixture connect/reload/stop and four-width settings checks pass. These do not replace the original reference/before/after comparison. Structured per-server forms and dark/English/reduced-motion lifecycle checks remain incomplete.

## Configured MCP exact approval (2d8cdf3 / ce42900)

PageReviewCard-derived approval structure now shows actual server/tool, honest external-data impact, collapsible exact arguments and a generic operation approval button. Composer/settings no longer claim configured tools are synthetic-only. Actual native/daemon browser flow at1440/1280/390/320 has no full-page overflow, one receipt and no reload dispatch; see [screenshots and limits](mcp-runtime.md). No new upstream reference comparison or full tool/result UI acceptance.

## Normal-daemon MCP browser verification (7d42223)

The same reference-derived approval geometry was verified at1440/1280/390/320 using the normal application daemon, separate from the explicit synthetic test harness. Original configured-tool metadata and one actual fixture receipt remain visible; no built-in sample binding/fixture connection in production. [Normal-path screenshots and limitations](synthetic-isolation.md). This is not a new full OpenDots fidelity comparison or a live business-system claim.

## Explicit model image input (0cf5d5f)

Model settings now uses the existing reference-derived form/card tokens for a default-off image-input checkbox and configured/unverified capability label. No new layout system or upstream setting is introduced. Four-width actual browser checks and visually inspected desktop/320px screenshots are linked in mcp-typed-results.md. This slice does not replace the original reference/before/after comparison or complete settings acceptance.

## MCP data approval target (567344c)

The existing PageReviewCard-derived card now supports mcp_data: readable action/server, daemon-resolved URI or prompt name, expandable exact arguments and shared approval actions. No new CSS/layout system. Four-width production-daemon browser checks and desktop/320px visual inspection are linked in mcp-data-retrieval.md; no new reference pixel comparison or full settings/library acceptance.

## Registered owner workspace preview (67013c5)

WorkspaceDialog-derived neutral dialog/forms now host Rocky local registration, actual directory browsing and UTF-8 source preview. Shared tokens, card borders/radii, compact16px icons, truncated file rows and existing responsive dialog geometry are reused; keyboard-focusable bounded source scrolling is an accessibility/owner-preview adaptation. There is no upstream cloud workspace persistence or per-card polling. Four-width normal-daemon browser checks, dark/English320px and actual screenshot inspection are recorded in [workspaces.md](workspaces.md). The original inline form and oversized filename control were corrected. No fresh reference/before/after or full SpaceLibrary fidelity claim; assistant workspace tools, result pane, immutable artifacts and remaining modules are unfinished.

## Explicit native workspace read scope (fcca9ad)

Workspace dialog selection, default-off composer scope and Work grant labels reuse existing neutral OpenDots-derived form/popover tokens. Sending closes the model/tools popover and resets next-Work scope; Escape returns focus to its summary. Native root/child reads use daemon authority, not UI flags. Four-width actual normal-daemon browser checks and inspected desktop/320 captures are in [workspace-native-reads.md](workspace-native-reads.md). No new CSS or upstream backend; no new matched reference/before/after comparison. Complete result/library/Computer and full theme/language/focus matrices remain gaps.

## Exact workspace write proposal (7118f9dbe34576be787fbea92305b029ef5dbac2)

Existing PageReviewCard-derived approval header/body/actions now render target, complete proposed content and collapsed original hash. Shared neutral tokens are retained; keyboard-focusable240px preview bounds long content without hiding authorization controls. This accessibility/readability difference is a Rocky adaptation. No newly copied upstream component or second state source. Four-width normal-daemon screenshots and browser checks are in [workspace-native-writes.md](workspace-native-writes.md); no fresh matched reference/before/after fidelity claim, full theme/language audit or completed diff/artifact/editor claim.

## Owner workspace difference review (53e9e2cee58c8cd18cee1cc09e275c210e879c48)

WriteProposal extracts the existing PageReviewCard-derived body, adds on-demand removed/added content in the existing bounded preview and encoding notices. Shared neutral tokens and original shell/actions remain; signs/side borders are an accessibility adaptation. No upstream backend, new polling or copied assets. Four-width real overwrite/preview screenshots are in [workspace-diff.md](workspace-diff.md). Scrolled controls are the comparable captured region; no new upstream full-page comparison or complete fidelity claim.

## Worktree approval adaptation (682b5c3fd2c2d6fc3765c4efed4cefa6d19cf7e0)

OpenDots reference remains c2569bb6a13a22e565cf3eb791c62267d06babb1. Existing PageReview-derived approval shell now displays daemon-prepared destination, branch, source HEAD, source Git metadata impact and committed-only/no-inherited-read scope. Existing card typography/tokens/action row retained, with compact definition rows in main.tsx/style.css; no new upstream asset/code copy or independent polling. Normal-daemon fixture browser checks four widths, reject/approve, reduced-motion keyboard Enter and scrolled mobile action visibility. [Screenshots and evidence](workspace-worktrees.md). This is a necessary Rocky permission adaptation; no equivalent upstream worktree-specific screenshot is claimed. New matched reference/before/after, English/dark matrix and full visual acceptance remain open.

## Artifact library and ResultPane (0a677c28fd8306b28c8ba9a1b1d58a425477d56b)

Compared fixed upstream ResultPane.tsx and style.css effective lines3300/3432/3461. Replaced initial generic centered artifact dialog with desktop right pane and responsive overlay. Rocky chrome.tsx/style.css use width clamp(390px,40vw,660px), top64, header56 and1100/700 breakpoints. Browser asserts widths576/512/390/320 and top64 at required viewports. Original Rocky artifact cards/preview/download/provenance adapt the existing reference tokens; no Dot selector or fabricated Computer. Keyboard Escape, inert overlay background and post-render focus return are necessary accessibility adaptations. [Evidence/screenshots](artifacts.md). No populated matched reference-before-after yet; raw-source preview is functional first slice, not completed OpenDots library/document parity.

## Markdown source editor (2a1d9208a08a6c6f1a9efc8af1ad7fac4efe7d03)

Compared upstream PageDocument.tsx sourceMode usage and editor.css document-source/title rules at fixedSHA. document-editor.tsx/style.css adapt420px source min-height,18px padding,13px/1.8 monospace and40px/32px title into the existing resultpane with neutral tokens/visiblefocus. ExplicitCAS/save/compare and tab-local draft retention are Rocky adaptations; upstream autosave, secondary assistant and rich-editor persistence not imported. [Four-width screenshots and tests](documents.md). This is source-mode adaptation, not complete PageDocument/rich-editor visual parity; matched reference/before/after and document dark-English matrix remain outstanding.

## Restricted HTML results (cf53d927ce311aba5c8c4f83dfff8d0468f3d768)

Existing ResultPane geometry, toolbar and neutral semantic tokens host the opaque iframe in artifacts.tsx/style.css. No additional upstream code/assets copied; source remains c2569bb6a13a22e565cf3eb791c62267d06babb1. Rocky adds an explicit restriction notice, source toggle and immutable download; generated content keeps a white canvas in both themes. [Four-width after screenshots and tests](html-preview.md). Interactive scripts, navigation, embeds and external resources are excluded to preserve local permission boundaries. No new matched upstream comparison or full fidelity claim.

## Native delivery into existing results (0f31a2a4104566b42b9a56fd689d71c599caa59e)

No new presentation component/CSS; artifact_publish feeds the existing shared projection and ResultPane cards. Browser verifies actual native write/approval/publication before preview/download at four widths. [Evidence](artifact-native.md). This is a Rocky functional integration; fixed upstream reference and remaining comparison gaps unchanged.

## Conversation delivery cards (e1e3b62f68e5af31340af3df860cb73645c091b4)

WorkArtifacts adapts fixed upstream PageReviewCard/style.css3707+ geometry:16px radius,14/18px header/footer,18/22px body,20px title,9px action radius. Neutral theme tokens replace hardcoded review colors; controls open/download confirmed Rocky snapshots. Existing resultpane/focus and shared event projection retained. [Four-width after screenshots/tests](artifact-cards.md). No matched reference/before/after claim or global completion.

Artifact failure recovery (9feaf7920138db6a9729071765697a741daac678) adds truthful load/retry states within existing typography/buttons. No layout/token or upstream source change; focused browser503/recovery evidence in artifact-load-recovery.json. No additional visual parity claim.

## Rocky presence adaptation (3d49ea33c52966c58b893e6bd128f49805c13ef7)

Original Rocky50px avatar stays within existing compact conversation header; short actual state text and a small keyboard motion preference replace generic status prose. Existing neutral tokens/typography retained; old header selectors removed. No additional upstream code/assets. [Evidence](presence.md). This is Rocky-specific presentation, not full fidelity/animation acceptance.

Presence feedback (05f77122594122b0be2eb3c9fb2933b4dc00af68) adds600ms2% scale only to confirmed fresh main completion and an offline last-sync label; original avatar and header geometry unchanged. Browser observes actual animation counts/reload/reconnect. This is an explicitly Rocky-specific adaptation, with no new upstream source copy or full fidelity claim.

Background presence navigation (1f1dac70310d3253147d79aa7bccf1aefee459d0) uses an initially collapsed summary and bounded neutral list, matching the established progressive disclosure and semantic theme system. Keyboard Enter closes the list and focuses exact Work. No new upstream source copied. [Tests/screenshots](presence.md). Full matched comparison remains open.

Admission wait presentation (84a5b4c27e15ebb3a79e6ad1a959473cfca66fdf) changes existing presence/Work label text using daemon waitingFor detail. No new panel, layout or upstream code. [Four-width header evidence](presence.md); no full reference comparison claim.

Document history (565e888edcb0fa2c0c71e34a15954bd44638fcad) reuses existing resultpane, document comparison and neutral form system. History starts collapsed; source title retains OpenDots-derived40/32px size while revision selector uses standard14px control. No new upstream component copied. [Four-width evidence](documents.md). Matched reference comparison and complete language/theme matrix remain open.

Owner Memory UI (d666feff90f5c07f917c01c0773aa62466e99496) is a Rocky-specific settings adaptation using existing collapsed settings, neutral cards/forms, semantic tokens and dialog scroll ownership. No new upstream source copied. [Four-width after evidence](memory-registry.md); new matched reference comparison, English/dark and complete keyboard matrix not_run.

Memory source controls (6256a1653ab36448851b8c62c4eb8423549a10e0) extend the existing neutral settings form and collapsed evidence pattern with pinned document revision links. No new upstream code copied. [Four-width after screenshots](memory-registry.md); full matched reference comparison remains pending.

Memory scope coverage (5f192c636d6444f740bb8371c7715cca5707506f) adds four-width English/dark long-text evidence and basic keyboard/error-retry verification in the existing settings dialog. No new layout or upstream code. [Evidence](memory-registry.md). These after screenshots do not replace matched reference comparison.

Memory grant UI (e56869c3a43e6d83512925041d75b70e69d2e402) uses existing collapsed Work permissions and neutral form styles, avoiding permanent extra panels. Owner-only scope/private controls are a Rocky adaptation. [Four-width after evidence](memory-registry.md); no new upstream code or full matched reference claim.

Composer memory consent (95c144678f0c591e6b990ae7b4d5b9c8b122523a) uses existing OpenDots-aligned Model/tools popover and semantic form controls, with no permanent panel. Rocky adaptation makes scope and private-to-model consent explicit. [Four-width after evidence](memory-registry.md); complete reference comparison remains pending.

Memory write approval (0aa4073ac3960576cbb592be22a2043b8398be59) uses existing PageReviewCard-aligned border/header/footer and proposal spacing, with translated scope/privacy/revision and scrollable proposed text. This is a Rocky-specific exact-consent adaptation; no new upstream code copied. [Four-width after evidence](memory-registry.md). Update diff and matched reference comparison remain open.

Memory diff (0386c45882cfc2a762d5158c4d79bf07b2421724) reuses established proposal-review/diff card styles, with explicit disclosure and source details.320px double padding was removed after visual inspection. [Four-width after evidence](memory-registry.md). No upstream source copy or full matched alignment claim.

Skills review (7e2712bba4993f3e7accf22085609ddb740a808f) reuses existing OpenDots-aligned workspace dialog, model-card spacing, forms/actions and proposal content scrolling. Sidebar Skills replaces its placeholder; no new upstream code or CSS copied. Rocky-specific source/license/acknowledgment and exact lifecycle controls preserve daemon authority. [Four-width after evidence](evidence/2026-10-04/skill-ui.json); final320 visually inspected. Import/history/full-file review and matched reference comparison remain pending.

Skill folder import (bf1cbf1b91305775569ac399718de3d287a485aa) adds a collapsed form inside the existing Skills dialog, reusing model-card/fieldset/input/select/action styling. No new visual token system or upstream source copy. [Four-width import screenshots](evidence/2026-10-04/skill-import.json);320 inspected. Matched reference comparison and complete theme/language/focus matrix remain pending.

Skill file/history review (6f08d5068e5e5a801a069f034347e4b65e748e81) extends the existing dialog with compact previous/next buttons and a file select, retaining original names and collapsed hashes. Existing neutral form/proposal styles reused; no new CSS. [Four-width after evidence](evidence/2026-10-04/skill-files.json),320 inspected. Matched reference comparison remains pending.

Skill update (0ad24f8d7be0d5495aae684c2a227c88f0c72e70) reuses the same folder form with a target/version summary, disabled scope and cancel action. Picker focus is browser-verified; no additional CSS. [320px evidence](evidence/2026-10-04/skill-update.json). Matched reference comparison remains pending.

### Skill version diff — 2026-10-04

`skill-diff.tsx` reuses the existing neutral button/details and diff-preview language for a Rocky-specific Skills adaptation. It compares immutable revisions through the daemon, with collapsed changed-file inventory and explicit binary/truncation states. No additional upstream code/assets copied; reference remains c2569bb6a13a22e565cf3eb791c62267d06babb1. [320px after](evidence/2026-10-04/skill-diff/after-320.png), [test evidence](evidence/2026-10-04/skill-diff.json). This is after-only fixture evidence, not matched reference/before/after proof. Full alignment and accessibility matrix remain incomplete.

Skill binary comparison follow-up (`fcf861d`): existing details/typography tokens display both revision hashes and sizes without a new layout or asset. [320px after](evidence/2026-10-04/skill-binary-diff/after-320.png) inspected; hashes wrap within the existing narrow review card. [Three browser flows](evidence/2026-10-04/skill-binary-diff.json) pass. This is a Rocky-specific functional adaptation and after-only fixture evidence, not a completed matched OpenDots comparison.

### Work Skill revocation notice — 2026-10-04

`skill-revocation.tsx`, mounted within each main transcript Work, reuses the existing approval card and collapsed evidence language. This Rocky-specific permission notice explains catalog quarantine, conditional loaded-skill restrictions and that prior effects are not undone. No additional upstream code or assets copied; reference remains c2569bb6a13a22e565cf3eb791c62267d06babb1. Shared persisted projection is the only data source. [Evidence and four-width screenshots](evidence/2026-10-04/skill-revoke-ui.json), [320px after](evidence/2026-10-04/skill-revoke-ui/after-320.png). After-only Chinese/light fixture evidence; matched comparison and full accessibility matrix remain pending.

### Local Skill discovery — 2026-10-04

`skill-discovery.tsx` is mounted above folder import in the existing Skills dialog. It reuses neutral model-card forms and details disclosure; source hash stays collapsed, import and truth-based untrusted state remain explicit. No new CSS or upstream assets/code copied; fixed OpenDots reference unchanged. [Evidence and four-width after screenshots](evidence/2026-10-04/skill-discovery-ui.json), [320px after](evidence/2026-10-04/skill-discovery-ui/after-320.png). This Rocky-specific source workflow has no direct upstream equivalent. After-only Chinese/light evidence does not complete matched reference comparison or the full accessibility matrix.

### Learning policy — 2026-10-04

`learning-settings.tsx` replaces sidebar panel5 placeholder using the existing Chrome dialog, neutral form/card controls and explicit saved status. No additional upstream source/CSS copied; same fixed OpenDots reference remains. Learning scope/consent are necessary Rocky-specific controls, and unimplemented reflection is visibly disclosed. [Four-width fixture evidence](evidence/2026-10-04/learning-policy-ui.json), [320px after](evidence/2026-10-04/learning-policy-ui/after-320.png). After-only evidence; full reference comparison and keyboard/theme/language coverage remain pending.

### Work Learning permissions — 2026-10-04

`work-learning.tsx` uses existing transcript details/model-card controls inside Work details, collapsed by default. Data is fetched on expansion and mutations use daemon CAS; no polling or new state source. This is a necessary Rocky Learning adaptation; no upstream CSS/assets copied. [Four-width evidence](evidence/2026-10-04/work-learning-ui.json), [320px after](evidence/2026-10-04/work-learning-ui/after-320.png). Long forms scroll within transcript; composer remains outside. After-only fixture proof does not close matched OpenDots comparison or complete focus/theme/language coverage.

### Manual episode summary — 2026-10-04

`learning-episode-form.tsx` extends existing collapsed Work Learning controls with neutral forms and text preview. Event types have readable labels; raw record ID stays in details. No new upstream code/CSS/assets copied; this is a Rocky-specific Learning workflow. [320px after](evidence/2026-10-04/learning-episode-ui/after-320.png), [browser evidence](evidence/2026-10-04/learning-episode-ui.json). Native fixture evidence is synthetic service input, not live provider proof. No matched OpenDots comparison or full theme/form/focus matrix completed.

### Persisted Learning summaries — 2026-10-04

`learning-episodes.tsx` adds explicit-refresh cards and nested source evidence under the same Learning dialog. Existing neutral card/details/type styles reused; no new upstream source copied. [320px after](evidence/2026-10-04/learning-library/after-320.png), [tests](evidence/2026-10-04/learning-library.json). Persistent summaries are clearly labeled owner-provided/unverified. This is an after-only fixture capture, not a completed reference comparison or full responsive/accessibility matrix.

### Exact summary review — 2026-10-04

Existing Learning cards now include an explicit acknowledgment and primary approve/secondary reject actions within expanded content. Saved status distinguishes pending/approved/rejected; approval explicitly excludes skill publication. No new upstream CSS or assets copied. [320px approved state](evidence/2026-10-04/learning-review/after-320.png), [test evidence](evidence/2026-10-04/learning-review.json). After-only fixture evidence; full controls/focus/theme/reference comparisons remain pending.
