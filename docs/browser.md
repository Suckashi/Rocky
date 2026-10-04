# Owned Browser / 專用瀏覽器

In advanced Work options, supply exact HTTP(S) origins, one per line, to authorize a clean Rocky-owned profile. Empty origins grant no Browser access. Each navigation and page action still requires owner approval. Chromium is optional and installed only by the explicit `npm run setup:browser` command; core startup does not download it.

在 Work 進階選項填入確切 origins 才授予 Browser 範圍；空白不授權。導覽與頁面操作仍需精確核准。Browser 面板可開啟專用視窗、擷取 PNG 快照、接管、釋放及關閉該 profile。

Snapshots persist profile, environment and page IDs, navigation revision, URL, timestamp, accessibility text and an image hash. They are historical captures, not a live video stream. An action references an exact snapshot and uniquely observed accessibility role/name. Navigation, prior actions, takeover and release invalidate old snapshots; the dispatcher also compares current accessibility content before element input. Dynamic page races cannot be eliminated entirely, and external business effects are not proven by a completed click.

接管先禁止新 agent input，再等待已送出的有界操作結束。owner 使用專用視窗操作；釋放後必須擷取新快照。只影響該 profile，不關閉其他瀏覽器或 profile。結果不明的操作不自動重播。

Profiles are exclusive by default. The owner may explicitly enable sharing with an account-scope label; future Works must explicitly select that shared profile. Cookies and signed-in accounts are shared, but never returned in public profile DTOs. Works using the same profile are serialized. Existing per-profile origin restrictions remain in force. Browser profile storage is runtime-private and must not enter Git or public evidence.

Native Chromium uses the owner's OS authority. The request-origin gate, blocked service workers/WebSockets and browser flags are **application-only** restrictions, not a proven OS egress sandbox. The known browser-egress environment blocker remains open. Container-selected profiles require a separately verified in-container browser transport; its absence returns unavailable and never opens a host browser. No browser launch, network smoke, takeover E2E or clean-environment egress acceptance has been executed for this implementation yet.
