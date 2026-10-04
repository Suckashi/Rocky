# Execution environments / 執行環境

Native commands run with the owner's OS authority and have no filesystem or network sandbox. Select an isolated environment explicitly in Work options to use container commands; unavailable containers never fall back to Native tools.

Native 命令使用本機 OS 權限，不是 sandbox。在 Work 選項明確選定隔離環境後，命令只送至該容器；不可用時不會改用主機工具。

The local Docker CLI adapter requires an already installed engine executable and image pinned by `@sha256:` digest. Rocky neither installs an engine nor pulls images. Engine compatibility is **unverified** until a real engine smoke run is recorded. Docker Desktop licensing remains independent of Rocky. Core installation does not require a container engine.

引擎與 image 須由 owner 預先安裝。adapter 相容性尚待真實引擎證據，不代表已通過 Docker／Podman 測試。核心安裝不要求容器。

Only the registered workspace is bind-mounted at `/work`. The container uses network `none`, a read-only root, unprivileged numeric user `65534:65534`, no Linux capabilities, no-new-privileges, PID/CPU/memory limits and a bounded `/tmp`. The pinned image must provide `node` for its idle supervisor. Workspace permissions must permit that numeric user; Rocky does not change host permissions. No home, domain database, credential directory or engine socket is mounted. Container inspection must match identity, image, mount and resource policy before commands run. Reported network restriction is configuration evidence, not full egress acceptance evidence.

容器只掛載選定 workspace，停止不刪除 workspace 或 volumes。取消命令時，終止 CLI 不等於容器程序已停止；Rocky 會停止該 owned container 並查詢，仍保留命令效果未知。重啟 daemon 不自動重播容器操作，須查詢既有狀態。重設與刪除尚未提供，不能以 stop 代替資料刪除。

Implementation and fixture tests are present; concentrated verification and live engine smoke evidence are pending. No live engine was invoked during implementation.
