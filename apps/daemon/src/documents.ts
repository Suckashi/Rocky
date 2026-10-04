import { createHash } from "node:crypto";
import { z } from "zod";
import {
  documentSchema,
  documentCreateSchema,
  documentSaveSchema,
  documentNewSchema,
  documentWriteToolSchema,
} from "../../../packages/contracts/src/documents.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
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
  history(id: string, before?: number) {
    this.get(id);
    if (before !== undefined) z.number().int().positive().safe().parse(before);
    const rows = this.store.db
      .prepare(
        "SELECT data FROM document_versions WHERE document_id=? AND revision<? ORDER BY revision DESC LIMIT 51",
      )
      .all(id, before ?? Number.MAX_SAFE_INTEGER) as { data: string }[];
    const revisions = rows
      .slice(0, 50)
      .map((row) => documentSchema.parse(JSON.parse(row.data)));
    return {
      revisions,
      nextBefore: rows.length > 50 ? revisions.at(-1)!.revision : null,
    };
  }
  modelProposal(work: Work, input: unknown) {
    const command = documentWriteToolSchema.parse(input);
    if (work.runMode !== "normal" || work.mode !== "configured")
      throw new RockyError(
        "document_scope",
        "Documents require a normal configured Work",
        403,
      );
    this.validate(command.title);
    this.validate(command.content);
    const row = this.store.db
      .prepare("SELECT id FROM documents WHERE id=?")
      .get(command.id);
    if (!row) {
      if (command.expectedRevision !== 0)
        throw new RockyError("document_missing", "Document is missing", 404);
    } else {
      const current = this.get(command.id).document;
      if (
        current.sourceWorkId !== work.id &&
        (!work.workspaceId || current.scope.workspaceId !== work.workspaceId)
      )
        throw new RockyError(
          "document_scope",
          "Document is outside this Work scope",
          403,
        );
      if (command.expectedRevision !== current.revision)
        throw new RockyError(
          "document_conflict",
          "Document changed; prepare a fresh proposal",
          409,
        );
    }
    return command;
  }
  saveModel(work: Work, input: unknown, requestId: string) {
    if (!this.store.db.isTransaction)
      throw new RockyError(
        "document_transaction",
        "Document publication requires an operation transaction",
        500,
      );
    const command = this.modelProposal(work, input);
    const hash = intentHash({
      kind: "model",
      workId: work.id,
      ...command,
      content: sha(command.content),
    });
    const prior = this.replay(requestId, hash);
    if (prior) return prior;
    const now = new Date().toISOString();
    const current = command.expectedRevision
      ? this.get(command.id).document
      : undefined;
    const document = documentSchema.parse({
      ...(current ?? {
        id: command.id,
        scope: work.workspaceId ? { workspaceId: work.workspaceId } : {},
        sourceWorkId: work.id,
        sourceRunId: work.runId,
        createdAt: now,
      }),
      title: command.title,
      contentBlobRef: sha(command.content),
      revision: command.expectedRevision + 1,
      updatedAt: now,
    });
    if (current)
      this.store.db
        .prepare(
          "UPDATE documents SET revision=?,data=? WHERE id=? AND revision=?",
        )
        .run(
          document.revision,
          JSON.stringify(document),
          document.id,
          command.expectedRevision,
        );
    else
      this.store.db
        .prepare("INSERT INTO documents VALUES(?,?,?)")
        .run(document.id, document.revision, JSON.stringify(document));
    this.persist(document, command.content, requestId, hash);
    return { document, content: command.content };
  }
  createNew(input: unknown) {
    const command = documentNewSchema.parse(input);
    this.validate(command.title);
    this.validate(command.content);
    const hash = intentHash({
      kind: "new",
      requestId: command.requestId,
      title: command.title,
      contentHash: sha(command.content),
    });
    return this.store.transaction(() => {
      const prior = this.replay(command.requestId, hash);
      if (prior) return prior;
      const now = new Date().toISOString();
      const document = documentSchema.parse({
        id: command.requestId,
        title: command.title,
        contentBlobRef: sha(command.content),
        revision: 1,
        scope: {},
        createdAt: now,
        updatedAt: now,
      });
      this.store.db
        .prepare("INSERT INTO documents VALUES(?,?,?)")
        .run(document.id, 1, JSON.stringify(document));
      this.persist(document, command.content, command.requestId, hash);
      return { document, content: command.content };
    });
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
    if (document.sourceWorkId)
      this.store.event(
        this.store.get(document.sourceWorkId),
        "rocky.document.updated",
        { document },
      );
  }
}
