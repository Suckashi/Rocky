import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import {
  browserActionSchema,
  browserControlSchema,
  browserNavigateSchema,
  browserOriginsSchema,
  browserProfileSchema,
  browserSnapshotSchema,
  browserSharingSchema,
  type BrowserProfile,
} from "../../../packages/contracts/src/browser.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { intentHash } from "./intent.js";

type Session = {
  context: BrowserContext;
  page: Page;
  pageId: string;
  navigationRevision: number;
  busy: boolean;
};
export class BrowserProfiles {
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  constructor(private readonly store: Store) {
    for (const profile of this.list())
      if (!["closed", "unavailable"].includes(profile.state)) {
        profile.state = "unknown";
        profile.freshSnapshotRequired = true;
        profile.error =
          "Daemon restarted. No browser action was replayed; reopen this owned profile and capture a fresh snapshot.";
        this.persist(profile);
      }
  }
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM browser_profiles ORDER BY rowid DESC")
        .all() as { data: string }[]
    ).map((row) => browserProfileSchema.parse(JSON.parse(row.data)));
  }
  get(id: string) {
    const row = this.store.db
      .prepare("SELECT data FROM browser_profiles WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row)
      throw new RockyError("browser_missing", "Browser profile not found", 404);
    return browserProfileSchema.parse(JSON.parse(row.data));
  }
  bind(work: Work, origins: unknown) {
    if (!this.store.db.isTransaction)
      throw new RockyError(
        "browser_transaction",
        "Profile creation requires Work admission transaction",
        500,
      );
    const now = new Date().toISOString();
    const profile = browserProfileSchema.parse({
      id: randomUUID(),
      environmentId: work.environmentId ?? work.runId,
      workId: work.id,
      revision: 1,
      mode: work.environmentId ? "isolated" : "native",
      sharingPolicy: "exclusive",
      allowedOrigins: browserOriginsSchema.parse(origins),
      state: "closed",
      freshSnapshotRequired: true,
      networkEnforcement: "application_only",
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    this.store.db
      .prepare("INSERT INTO browser_profiles VALUES(?,?,?)")
      .run(profile.id, work.id, JSON.stringify(profile));
    return profile.id;
  }
  bindShared(work: Work, id: string) {
    if (!this.store.db.isTransaction)
      throw new RockyError(
        "browser_transaction",
        "Profile binding requires Work admission transaction",
        500,
      );
    const profile = this.get(id);
    if (
      profile.sharingPolicy !== "shared" ||
      profile.authorizedWorkIds.length >= 100 ||
      (work.environmentId
        ? profile.environmentId !== work.environmentId
        : profile.mode !== "native")
    )
      throw new RockyError(
        "browser_scope",
        "Shared profile is unavailable for this Work or has reached its binding limit",
        409,
      );
    profile.authorizedWorkIds.push(work.id);
    this.persist(profile);
    return profile.id;
  }
  share(id: string, input: unknown) {
    const command = browserSharingSchema.parse(
        typeof input === "object" && input
          ? { action: "share", ...input }
          : input,
      ),
      intent = intentHash({ id, share: command });
    return this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT intent,data FROM browser_control_receipts WHERE request_id=?",
        )
        .get(command.requestId) as { intent: string; data: string } | undefined;
      if (prior) {
        if (prior.intent !== intent)
          throw new RockyError(
            "idempotency_conflict",
            "Sharing command changed",
            409,
          );
        return browserProfileSchema.parse(JSON.parse(prior.data).profile);
      }
      const profile = this.get(id);
      if (
        profile.revision !== command.profileRevision ||
        this.sessions.get(id)?.busy
      )
        throw new RockyError(
          "browser_stale",
          "Profile changed or an action is active",
          409,
        );
      profile.sharingPolicy =
        command.action === "share" ? "shared" : "exclusive";
      profile.accountLabel =
        command.action === "share" ? command.accountLabel : null;
      if (command.action === "revoke") {
        profile.authorizedWorkIds = [];
        profile.freshSnapshotRequired = true;
      }
      this.persist(profile);
      this.store.db
        .prepare("INSERT INTO browser_control_receipts VALUES(?,?,?)")
        .run(
          command.requestId,
          intent,
          JSON.stringify({ status: "completed", profile }),
        );
      return profile;
    });
  }
  private persist(profile: BrowserProfile) {
    profile.revision = this.get(profile.id).revision + 1;
    profile.updatedAt = new Date().toISOString();
    browserProfileSchema.parse(profile);
    const save = () => {
      this.store.db
        .prepare("UPDATE browser_profiles SET data=? WHERE id=?")
        .run(JSON.stringify(profile), profile.id);
      this.store.event(
        this.store.get(profile.workId),
        "rocky.browser.profile",
        { profile },
      );
    };
    if (this.store.db.isTransaction) save();
    else this.store.transaction(save);
    return profile;
  }
  forWork(work: Work) {
    if (
      work.mode !== "configured" ||
      work.runMode !== "normal" ||
      !work.browserProfileId
    )
      throw new RockyError(
        "browser_scope",
        "No owner-authorized browser profile for this Work",
        403,
      );
    const profile = this.get(work.browserProfileId);
    if (
      (profile.workId !== work.id &&
        !profile.authorizedWorkIds.includes(work.id)) ||
      (work.environmentId
        ? profile.environmentId !== work.environmentId
        : profile.mode !== "native")
    )
      throw new RockyError(
        "browser_scope",
        "Browser profile identity does not match this Work",
        403,
      );
    return profile;
  }
  private allowed(profile: BrowserProfile, input: string) {
    const url = new URL(input);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !profile.allowedOrigins.includes(url.origin)
    )
      throw new RockyError(
        "browser_origin",
        "URL is outside this profile's explicitly allowed origins",
        403,
      );
    return url.href;
  }
  private async open(profile: BrowserProfile) {
    if (this.closing)
      throw new RockyError("stopping", "Browser manager is stopping", 503);
    const prior = this.sessions.get(profile.id);
    if (prior) {
      if (profile.state !== "ready" && profile.state !== "owner")
        throw new RockyError(
          "browser_unknown",
          "Close this uncertain session before opening a new one",
          409,
        );
      return prior;
    }
    if (profile.mode !== "native") {
      profile.state = "unavailable";
      profile.error =
        "The selected container has no verified browser transport. No Native fallback is permitted.";
      this.persist(profile);
      throw new RockyError("browser_unavailable", profile.error, 409);
    }
    profile.state = "starting";
    this.persist(profile);
    const root = join(this.store.root, "browser-profiles"),
      path = join(root, profile.id);
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink())
      throw new RockyError("browser_path", "Profile storage is linked", 409);
    await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink())
      throw new RockyError("browser_path", "Profile directory is linked", 409);
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(path, {
        headless: false,
        chromiumSandbox: true,
        acceptDownloads: false,
        serviceWorkers: "block",
        permissions: [],
        viewport: { width: 1280, height: 800 },
        timeout: 15000,
        args: [
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-sync",
          "--no-first-run",
        ],
      });
      await context.route("**/*", async (route) => {
        try {
          this.allowed(this.get(profile.id), route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient").catch(() => undefined);
        }
      });
      await context.routeWebSocket("**/*", (socket) => socket.close());
      if (this.closing || this.get(profile.id).state !== "starting")
        throw new RockyError(
          "browser_cancelled",
          "Browser startup was superseded",
          409,
        );
      const page = context.pages()[0] ?? (await context.newPage());
      const session: Session = {
        context,
        page,
        pageId: randomUUID(),
        navigationRevision: 1,
        busy: false,
      };
      this.sessions.set(profile.id, session);
      const invalidate = () => {
        session.navigationRevision++;
        if (!this.closing && this.sessions.get(profile.id) === session) {
          const current = this.get(profile.id);
          current.freshSnapshotRequired = true;
          this.persist(current);
          this.store.event(
            this.store.get(current.workId),
            "rocky.browser.navigation",
            {
              profileId: current.id,
              pageId: session.pageId,
              navigationRevision: session.navigationRevision,
              url: session.page.url(),
            },
          );
        }
      };
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) invalidate();
      });
      page.on(
        "dialog",
        (dialog) => void dialog.dismiss().catch(() => undefined),
      );
      page.on(
        "download",
        (download) => void download.cancel().catch(() => undefined),
      );
      context.on("page", (popup) => {
        if (popup !== session.page) void popup.close().catch(() => undefined);
      });
      context.on("close", () => {
        if (this.sessions.get(profile.id) !== session) return;
        this.sessions.delete(profile.id);
        if (!this.closing) {
          const current = this.get(profile.id);
          current.state = "closed";
          current.freshSnapshotRequired = true;
          this.persist(current);
        }
      });
      profile.state = "ready";
      profile.freshSnapshotRequired = true;
      profile.error = null;
      this.persist(profile);
      return session;
    } catch {
      await context?.close().catch(() => undefined);
      this.sessions.delete(profile.id);
      const current = this.get(profile.id);
      const message =
        "Owned Chromium could not start. Install the optional pinned browser explicitly; no browser or host fallback was attempted.";
      if (current.state === "starting") {
        current.state = "unavailable";
        current.error = message;
        this.persist(current);
      }
      throw new RockyError("browser_unavailable", message, 409);
    }
  }
  private track<T>(pending: Promise<T>) {
    this.pending.add(pending);
    void pending
      .finally(() => this.pending.delete(pending))
      .catch(() => undefined);
    return pending;
  }
  control(id: string, input: unknown) {
    return this.track(this.controlOwned(id, input));
  }
  private async controlOwned(id: string, input: unknown) {
    if (this.closing)
      throw new RockyError("stopping", "Browser manager is stopping", 503);
    const command = browserControlSchema.parse(input),
      intent = intentHash({ id, ...command });
    const replay = this.store.db
      .prepare(
        "SELECT intent,data FROM browser_control_receipts WHERE request_id=?",
      )
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (replay) {
      if (replay.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Browser command changed",
          409,
        );
      const receipt = JSON.parse(replay.data);
      if (receipt.status === "pending")
        throw new RockyError(
          "browser_control_unknown",
          "Control receipt is incomplete; inspect current profile state without replaying the command",
          409,
        );
      if (receipt.error)
        throw new RockyError(
          receipt.error.code,
          receipt.error.message,
          receipt.error.status,
        );
      return browserProfileSchema.parse(receipt.profile);
    }
    const profile = this.get(id);
    if (
      profile.revision !== command.profileRevision ||
      (["starting", "taking_over"].includes(profile.state) &&
        command.action !== "close")
    )
      throw new RockyError(
        "browser_stale",
        "Browser profile changed or is busy",
        409,
      );
    this.store.db
      .prepare("INSERT INTO browser_control_receipts VALUES(?,?,?)")
      .run(
        command.requestId,
        intent,
        JSON.stringify({ status: "pending", profile }),
      );
    let failure: { code: string; message: string; status: number } | undefined;
    try {
      if (command.action === "open") {
        await this.open(profile);
        return this.get(id);
      }
      if (command.action === "take") {
        profile.state = "taking_over";
        this.persist(profile);
        const session = this.sessions.get(id);
        // Admission is fenced immediately. Existing bounded actions finish before handover.
        if (!session)
          throw new RockyError(
            "browser_unavailable",
            "Open the profile before taking control",
            409,
          );
        while (session.busy)
          await new Promise((resolve) => setTimeout(resolve, 25));
        const current = this.get(id);
        if (
          current.state !== "taking_over" ||
          this.sessions.get(id) !== session
        )
          throw new RockyError(
            "browser_control",
            "Takeover was superseded by another owner command",
            409,
          );
        current.state = "owner";
        current.freshSnapshotRequired = true;
        this.persist(current);
        await session.page.bringToFront();
      } else if (command.action === "release") {
        if (profile.state !== "owner")
          throw new RockyError(
            "browser_control",
            "This profile is not under manual control",
            409,
          );
        const session = this.sessions.get(id);
        if (!session)
          throw new RockyError(
            "browser_unavailable",
            "Browser session is unavailable",
            409,
          );
        session.navigationRevision++;
        profile.state = "ready";
        profile.freshSnapshotRequired = true;
        this.persist(profile);
      } else {
        profile.state = "taking_over";
        this.persist(profile);
        await this.sessions.get(id)?.context.close();
        const current = this.get(id);
        current.state = "closed";
        current.freshSnapshotRequired = true;
        this.persist(current);
      }
      return this.get(id);
    } catch (error) {
      failure =
        error instanceof RockyError
          ? { code: error.code, message: error.message, status: error.status }
          : {
              code: "browser_control_failed",
              message: "Browser control did not complete",
              status: 409,
            };
      const current = this.get(id);
      if (["taking_over", "starting"].includes(current.state)) {
        current.state = "unknown";
        current.freshSnapshotRequired = true;
        current.error =
          "Browser control did not complete. Inspect or reopen this owned profile before continuing.";
        this.persist(current);
      }
      throw error;
    } finally {
      this.store.db
        .prepare(
          "UPDATE browser_control_receipts SET data=? WHERE request_id=?",
        )
        .run(
          JSON.stringify({
            status: failure ? "failed" : "completed",
            profile: this.get(id),
            ...(failure ? { error: failure } : {}),
          }),
          command.requestId,
        );
    }
  }
  private session(work: Work) {
    const profile = this.forWork(work),
      session = this.sessions.get(profile.id);
    if (profile.state !== "ready" || !session || session.busy)
      throw new RockyError(
        "browser_unavailable",
        "Browser is unavailable, busy, or under owner control",
        409,
      );
    return { profile, session };
  }
  snapshot(work: Work) {
    return this.track(this.capture(work));
  }
  private async capture(work: Work) {
    const { profile, session } = this.session(work);
    session.busy = true;
    try {
      const navigationRevision = session.navigationRevision;
      const text = (
        await session.page.locator("body").ariaSnapshot({ timeout: 5000 })
      ).slice(0, 65536);
      const image = await session.page.screenshot({
        type: "png",
        timeout: 5000,
      });
      if (
        session.navigationRevision !== navigationRevision ||
        this.get(profile.id).state !== "ready"
      )
        throw new RockyError(
          "browser_stale",
          "Page or control changed during capture",
          409,
        );
      if (image.length > 10485760)
        throw new RockyError(
          "snapshot_limit",
          "Browser image exceeds limit",
          413,
        );
      const snapshot = browserSnapshotSchema.parse({
        snapshotId: randomUUID(),
        profileId: profile.id,
        environmentId: profile.environmentId,
        pageId: session.pageId,
        url: session.page.url(),
        navigationRevision,
        capturedAt: new Date().toISOString(),
        text: this.store.publicEvidence(text),
        imageSha256: createHash("sha256").update(image).digest("hex"),
        stale: false,
      });
      this.store.transaction(() => {
        this.store.db
          .prepare("INSERT INTO browser_snapshots VALUES(?,?,?,?)")
          .run(
            snapshot.snapshotId,
            profile.id,
            JSON.stringify(snapshot),
            image,
          );
        profile.freshSnapshotRequired = false;
        this.persist(profile);
        this.store.event(work, "rocky.browser.snapshot", { snapshot });
      });
      return snapshot;
    } finally {
      session.busy = false;
    }
  }
  readSnapshot(id: string) {
    const row = this.store.db
      .prepare("SELECT data,image FROM browser_snapshots WHERE id=?")
      .get(id) as { data: string; image: Uint8Array } | undefined;
    if (!row)
      throw new RockyError(
        "snapshot_missing",
        "Browser snapshot not found",
        404,
      );
    const snapshot = browserSnapshotSchema.parse(JSON.parse(row.data)),
      session = this.sessions.get(snapshot.profileId),
      profile = this.get(snapshot.profileId);
    if (
      createHash("sha256").update(row.image).digest("hex") !==
      snapshot.imageSha256
    )
      throw new RockyError(
        "snapshot_corrupt",
        "Snapshot image integrity failed",
        409,
      );
    snapshot.stale =
      !session ||
      session.pageId !== snapshot.pageId ||
      session.navigationRevision !== snapshot.navigationRevision ||
      profile.freshSnapshotRequired ||
      profile.state !== "ready";
    return { snapshot, image: row.image };
  }
  view(id: string) {
    const profile = this.get(id),
      row = this.store.db
        .prepare(
          "SELECT id FROM browser_snapshots WHERE profile_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(id) as { id: string } | undefined;
    return {
      profile,
      snapshot: row ? this.readSnapshot(row.id).snapshot : null,
    };
  }
  validate(work: Work, name: string, input: unknown) {
    const profile = this.forWork(work);
    if (["owner", "taking_over", "starting"].includes(profile.state))
      throw new RockyError(
        "browser_control",
        "Agent input is disabled for this profile",
        409,
      );
    if (name === "browser_navigate")
      return {
        profile,
        args: browserNavigateSchema.parse({
          url: this.allowed(profile, browserNavigateSchema.parse(input).url),
        }),
      };
    const args = browserActionSchema.parse(input),
      { snapshot } = this.readSnapshot(args.snapshotId);
    if (
      snapshot.stale ||
      snapshot.profileId !== profile.id ||
      snapshot.pageId !== args.pageId ||
      snapshot.navigationRevision !== args.navigationRevision
    )
      throw new RockyError(
        "browser_stale",
        "A fresh snapshot is required for this exact profile and page",
        409,
      );
    const observed = `- ${args.role} ${JSON.stringify(args.name)}`;
    if (
      !snapshot.text.split("\n").some((line) => {
        const value = line.trim();
        return (
          value === observed ||
          value.startsWith(observed + ":") ||
          value.startsWith(observed + " [")
        );
      })
    )
      throw new RockyError(
        "browser_target",
        "The exact named target was not present in the approved snapshot",
        409,
      );
    if (args.action !== "click" && args.value === undefined)
      throw new RockyError("browser_action", "Action value is required", 422);
    return { profile, args };
  }
  execute(work: Work, name: string, input: unknown, signal: AbortSignal) {
    return this.track(this.executeOwned(work, name, input, signal));
  }
  private async executeOwned(
    work: Work,
    name: string,
    input: unknown,
    signal: AbortSignal,
  ) {
    const prepared = this.validate(work, name, input);
    if (name === "browser_navigate" && !this.sessions.has(prepared.profile.id))
      await this.open(prepared.profile);
    const { profile, session } = this.session(work);
    session.busy = true;
    const abort = () => {
      void session.context.close().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      if (name === "browser_navigate") {
        const args = browserNavigateSchema.parse(input);
        if (this.get(profile.id).state !== "ready")
          throw new RockyError(
            "browser_control",
            "Owner takeover fenced new agent input",
            409,
          );
        await session.page.goto(this.allowed(profile, args.url), {
          timeout: 15000,
          waitUntil: "domcontentloaded",
        });
      } else {
        const args = browserActionSchema.parse(input),
          { snapshot } = this.readSnapshot(args.snapshotId);
        if (
          snapshot.stale ||
          snapshot.text !==
            this.store.publicEvidence(
              (
                await session.page
                  .locator("body")
                  .ariaSnapshot({ timeout: 5000 })
              ).slice(0, 65536),
            )
        )
          throw new RockyError(
            "browser_stale",
            "Page content changed since the approved snapshot",
            409,
          );
        signal.throwIfAborted();
        if (this.get(profile.id).state !== "ready")
          throw new RockyError(
            "browser_control",
            "Owner takeover fenced new agent input",
            409,
          );
        const target = session.page.getByRole(args.role, {
          name: args.name,
          exact: true,
        });
        if ((await target.count()) !== 1)
          throw new RockyError(
            "browser_target",
            "Snapshot target is missing or ambiguous",
            409,
          );
        if (args.action === "click") await target.click({ timeout: 10000 });
        else if (args.action === "fill")
          await target.fill(args.value!, { timeout: 10000 });
        else await target.press(args.value!, { timeout: 10000 });
      }
      signal.throwIfAborted();
      session.navigationRevision++;
      const current = this.get(profile.id);
      current.freshSnapshotRequired = true;
      this.persist(current);
      return {
        profileId: profile.id,
        pageId: session.pageId,
        navigationRevision: session.navigationRevision,
        url: session.page.url(),
        outcome: "browser_action_completed",
        externalEffectsVerified: false,
      };
    } finally {
      signal.removeEventListener("abort", abort);
      session.busy = false;
    }
  }
  async close() {
    this.closing = true;
    await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.context.close()),
    );
    await Promise.allSettled([...this.pending]);
    this.sessions.clear();
  }
}
