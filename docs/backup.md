# Rocky backup and restore / 備份與還原

Build first with `npm run build`. Close Rocky browser profiles, then stop the daemon. Backup acquires the same exclusive writer lease as the daemon; it refuses a live writer. It never starts Work, reads Apsis stores, or follows external links.

```powershell
npm run backup -- --source "D:/RockyData" --destination "D:/RockyBackups/2026-10-04"
npm run backup:verify -- --source "D:/RockyBackups/2026-10-04"
npm run restore -- --source "D:/RockyBackups/2026-10-04" --destination "D:/RockyRestored"
```

The same commands work on Linux with local absolute paths. Both destinations must be new empty directories, separate from the source. A failed operation leaves an incomplete marker for inspection; Rocky refuses to start from it. Nothing overwrites an existing store. Backups themselves cannot be used as active data directories.

備份包含 Rocky 自己資料目錄的 domain、原生 graph checkpoints、附件／文件／技能、操作回條與已關閉的 browser profiles。外部註冊 workspace 的原始檔案、系統環境變數內的模型憑證、外部容器 volume 與遠端帳號不在 Rocky 資料目錄內，不會被偷偷複製。請另行管理這些外部資料。備份含私密內容與登入資料，未加密；請存放在你控制的受保護位置。

The manifest records product identity, store schema, graph format, Node/SQLite/ABI/platform metadata, exact portable paths, SHA-256, byte totals and file count. Restore checks all files before writing the destination, rejects unexpected files, links, traversal, foreign manifests, future schemas and damaged databases. SQLite snapshots use Node's backup API. No Python or compiler is involved.

還原後所有未完成工作均受阻，舊核准過期、grants 撤銷、Routines／Tracking／Automatic Learning 停用；容器需重新檢查，瀏覽器須重新開啟並取得新 snapshot。未知外部效果保留未知，必須對帳，不會因還原而重送。明確檢查設定與憑證後，再開始新工作或重新啟用排程。

Limits: 100,000 entries, 10 GiB per file, 50 GiB total, 16 MiB manifest, 64 directory levels. Cross-platform browser-cookie portability and real container restoration are not established by copying bytes. Concentrated backup/restore fixtures and platform verification remain pending in the implementation ledger.
