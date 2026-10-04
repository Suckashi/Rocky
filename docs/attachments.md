# Attachments / 附件

Owner uploads accept UTF-8 text/Markdown (64 KiB) and PNG/JPEG (2 MiB input, 4 million pixels, each dimension at most 4096). An isolated Node worker decodes and re-encodes images with a ten-second deadline and allocation bounds. Sanitized images are capped at 384 KiB. This validates supported content; it is not a malware-scanner certification. Metadata is removed, including EXIF orientation: check the uploaded image before submitting. No paths, URLs, HTML execution, or remote fetches are accepted.

附件先保存在 Rocky 私有資料庫；上傳不會呼叫模型。送出工作或修正時，會綁定最多八個固定 ID／版本／SHA-256。移除待送清單不會刪除已保存的證據。修正附件要等原生 checkpoint 確認套用後才可供工具讀取。模型與原生子工作用 `attachment_read` 取得限定範圍的內容；內容永遠是資料，不是授權或系統指令。

Images are passed as actual inline image blocks only when the selected model explicitly enables vision. Otherwise the tool reports that no visual interpretation occurred. Provider requests and private framed model transfers have an 8 MiB hard cap; token/context/call budgets remain enforced independently. Reading many attachments repeatedly can exhaust these limits and must not be reported as success. Text, names, and image pixels may contain private data; submitting a Work authorizes transmission to its selected model. No hidden credential or profile files are attached.

Implementation pending concentrated validation: codec fixtures, Work/steering scope, native child reads, model image transport, HTTP bounds and browser upload flow. No live model or browser evidence is claimed here.
