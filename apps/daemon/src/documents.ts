import { createHash } from "node:crypto";
import { z } from "zod";
import {
  documentSchema,
  documentCreateSchema,
  documentSaveSchema,
} from "../../../packages/contracts/src/documents.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { ArtifactStore } from "./artifacts.js";
import { intentHash } from "./intent.js";
const sha = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
export class DocumentStore {
  constructor(
    private readonly store: Store,
    private readonly artifacts: ArtifactStore,
  ) {}
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM documents ORDER BY rowid DESC LIMIT 200")
        .all() as { data: string }[]
    ).map((row) => documentSchema.parse(JSON.parse(row.data)));
  }
  get(id: string, revision?: number) {
    z.uuid().parse(id);
    if (revision !== undefined) z.number().int().positive().parse(revision);
    const row = (
      revision === undefined
        ? this.store.db.prepare("SELECT data FROM documents WHERE id=?").get(id)
        : this.store.db
            .prepare(
              "SELECT data FROM document_versions WHERE document_id=? AND revision=?",
            )
            .get(id, revision)
    ) as { data: string } | undefined;
    if (!row)
      throw new RockyError(
        "document_missing",
        "Document revision not found",
        404,
      );
    const document = documentSchema.parse(JSON.parse(row.data));
    const blob = this.store.db
      .prepare("SELECT content FROM document_blobs WHERE hash=?")
      .get(document.contentBlobRef) as { content: string } | undefined;
    if (!blob || sha(blob.content) !== document.contentBlobRef)
      throw new RockyError(
        "document_corrupt",
        "Document content integrity failed",
        409,
      );
    this.validate(blob.content);
    this.validate(document.title);
    return { document, content: blob.content };
  }
  private replay(requestId: string, hash: string) {
    const row = this.store.db
      .prepare(
        "SELECT intent,document_id,revision FROM document_receipts WHERE request_id=?",
      )
      .get(requestId) as
      { intent: string; document_id: string; revision: number } | undefined;
    if (!row) return;
    if (row.intent !== hash)
      throw new RockyError(
        "idempotency_conflict",
        "Document request changed",
        409,
      );
    return this.get(row.document_id, row.revision);
  }
  async create(input: unknown) {
    const command = documentCreateSchema.parse(input),
      hash = intentHash({ kind: "create", ...command });
    const previous = this.replay(command.requestId, hash);
    if (previous) return previous;
    const artifact = this.artifacts.get(command.artifactId),
      file = await this.artifacts.file(artifact.id, artifact.entry);
    if (!["text/markdown", "text/plain"].includes(file.entry.mime))
      throw new RockyError(
        "document_format",
        "Only Markdown and plain text can become editable documents",
        422,
      );
    this.validate(artifact.title);
    const content = file.bytes.toString("utf8");
    this.validate(content);
    const now = new Date().toISOString();
    const document = documentSchema.parse({
      id: command.requestId,
      title: artifact.title,
      revision: 1,
      contentBlobRef: sha(content),
      scope: { workspaceId: artifact.source.workspaceId },
      sourceArtifactId: artifact.id,
      sourceWorkId: artifact.workId,
      sourceRunId: artifact.runId,
      createdAt: now,
      updatedAt: now,
    });
    return this.store.transaction(() => {
      const repeated = this.replay(command.requestId, hash);
      if (repeated) return repeated;
      this.store.db
        .prepare("INSERT INTO documents VALUES(?,?,?)")
        .run(document.id, 1, JSON.stringify(document));
      this.persist(document, content, command.requestId, hash);
      return { document, content };
    });
  }
  private validate(content: string) {
    if (this.store.publicEvidence(content) !== content)
      throw new RockyError(
        "document_sensitive",
        "This document contains protected content and cannot be opened in the editor",
        422,
      );
    const bytes = Buffer.from(content, "utf8");
    if (
      bytes.toString("utf8") !== content ||
      bytes.length > 65536 ||
      content.includes("\0")
    )
      throw new RockyError(
        "document_limit",
        "Document content must be UTF-8 text up to64KiB without NUL",
        422,
      );
  }
  save(id: string, input: unknown) {
    const command = documentSaveSchema.parse(input);
    this.validate(command.content);
    this.validate(command.title);
    const hash = intentHash({
      kind: "save",
      id,
      requestId: command.requestId,
      expectedRevision: command.expectedRevision,
      title: command.title,
      contentHash: sha(command.content),
    });
    return this.store.transaction(() => {
      const repeated = this.replay(command.requestId, hash);
      if (repeated) return repeated;
      const current = this.get(id).document;
      if (current.revision !== command.expectedRevision)
        throw new RockyError(
          "document_conflict",
          "Document changed. Your draft has not been saved; compare the latest revision before retrying.",
          409,
        );
      const document = documentSchema.parse({
        ...current,
        title: command.title,
        revision: current.revision + 1,
        contentBlobRef: sha(command.content),
        updatedAt: new Date().toISOString(),
      });
      const updated = this.store.db
        .prepare(
          "UPDATE documents SET revision=?,data=? WHERE id=? AND revision=?",
        )
        .run(
          document.revision,
          JSON.stringify(document),
          id,
          command.expectedRevision,
        );
      if (updated.changes !== 1)
        throw new RockyError(
          "document_conflict",
          "Document revision changed",
          409,
        );
      this.persist(document, command.content, command.requestId, hash);
      return { document, content: command.content };
    });
  }
  private persist(
    document: z.infer<typeof documentSchema>,
    content: string,
    requestId: string,
    hash: string,
  ) {
    this.store.db
      .prepare("INSERT OR IGNORE INTO document_blobs VALUES(?,?)")
      .run(document.contentBlobRef, content);
    const blob = this.store.db
      .prepare("SELECT content FROM document_blobs WHERE hash=?")
      .get(document.contentBlobRef) as { content: string };
    if (sha(blob.content) !== document.contentBlobRef)
      throw new RockyError(
        "document_corrupt",
        "Document blob integrity failed",
        409,
      );
    this.store.db
      .prepare("INSERT INTO document_versions VALUES(?,?,?)")
      .run(document.id, document.revision, JSON.stringify(document));
    this.store.db
      .prepare("INSERT INTO document_receipts VALUES(?,?,?,?)")
      .run(requestId, hash, document.id, document.revision);
    this.store.event(
      this.store.get(document.sourceWorkId),
      "rocky.document.updated",
      { document },
    );
  }
}
