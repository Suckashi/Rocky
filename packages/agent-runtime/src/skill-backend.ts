import type {
  BackendProtocolV2,
  FileInfo,
  FileDownloadResponse,
  ReadResult,
} from "deepagents";

/** The daemon supplies pinned files; this adapter owns no cache or authority. */
export type SkillFilePort = {
  list(path: string): Promise<FileInfo[]>;
  read(
    path: string,
    metadata?: boolean,
  ): Promise<{ contentBase64: string; createdAt: string }>;
};
export class SkillBackend implements BackendProtocolV2 {
  constructor(private port: SkillFilePort) {}
  async ls(path: string) {
    return { files: await this.port.list(path) };
  }
  async read(path: string, offset = 0, limit = 500): Promise<ReadResult> {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 2000
    )
      return { error: "Invalid skill read pagination" };
    const raw = await this.port.read(path);
    const bytes = Buffer.from(raw.contentBase64, "base64");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes) || text.includes("\0"))
      return {
        error:
          "Binary skill assets require explicit download; text read denied",
      };
    const lines = text.split("\n");
    const selected: string[] = [];
    let size = 0;
    for (const line of lines.slice(offset, offset + limit)) {
      const added = Buffer.byteLength(line) + (selected.length ? 1 : 0);
      if (size + added > 16384) break;
      selected.push(line);
      size += added;
    }
    if (!selected.length && offset < lines.length)
      return { error: "Skill line exceeds 16 KiB read limit" };
    const next = offset + selected.length;
    return {
      content: selected.join("\n"),
      mimeType: "text/plain",
      totalLines: lines.length,
      startLine: offset + 1,
      endLine: next,
      ...(next < lines.length ? { nextOffset: next } : {}),
    };
  }
  async readRaw(path: string) {
    const raw = await this.port.read(path);
    return {
      data: {
        content: Buffer.from(raw.contentBase64, "base64"),
        mimeType: "application/octet-stream",
        created_at: raw.createdAt,
        modified_at: raw.createdAt,
      },
    };
  }
  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    if (paths.length > 128) throw Error("Skill download batch exceeds limit");
    const result: FileDownloadResponse[] = [];
    for (const path of paths) {
      const raw = await this.port.read(path, true);
      result.push({
        path,
        content: Buffer.from(raw.contentBase64, "base64"),
        error: null,
      });
    }
    return result;
  }
  write() {
    return { error: "Published skills are read-only" };
  }
  edit() {
    return { error: "Published skills are read-only" };
  }
  delete() {
    return { error: "Published skills are read-only" };
  }
  glob() {
    return { error: "Skill glob is unavailable; use the catalog path and ls" };
  }
  grep() {
    return {
      error: "Skill search is unavailable; read explicit catalog files",
    };
  }
}
