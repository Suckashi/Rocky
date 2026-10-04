import { test, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { workSchema } from "../packages/contracts/src/index.js";

// Prefer the pinned browser; an explicit override is compatibility evidence only.
const browserExecutable =
  process.env.ROCKY_TEST_BROWSER ?? chromium.executablePath();
test.skipIf(!existsSync(browserExecutable))(
  "owned native browser snapshots, exact targets and manual control fence stale actions",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rocky-native-browser-"));
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (request.url === "/set-a")
        response.setHeader(
          "Set-Cookie",
          "profile=A; Path=/; HttpOnly; SameSite=Strict",
        );
      response.end(
        "<!doctype html><title>Rocky synthetic browser</title><p>" +
          (request.headers.cookie === "profile=A"
            ? "Profile A cookie"
            : "No profile cookie") +
          "</p><label>Fixture input<input></label><button onclick=\"document.querySelector('output').textContent='Observed'\">Apply fixture</button><output></output>",
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const service = new WorkService(root);
    const launch = chromium.launchPersistentContext.bind(chromium);
    const observed = vi
      .spyOn(chromium, "launchPersistentContext")
      .mockImplementation(async (path, options) => {
        try {
          return await launch(path, {
            ...options,
            headless: true,
            executablePath: browserExecutable,
          });
        } catch (error) {
          // Synthetic fixture only: retain browser diagnostics before the product
          // converts them to its safe public unavailable error.
          console.error("Native browser fixture launch failed:", error);
          throw error;
        }
      });
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: "Local synthetic browser",
      mode: "configured",
      modelSelection: { connectionId: randomUUID(), revision: 1 },
      transport: "http",
      runMode: "normal",
      status: "completed",
      answer: "",
      revision: 1,
      createdAt: new Date().toISOString(),
    });
    try {
      service.store.transaction(() => {
        work.browserProfileId = service.browsers.bind(work, [origin]);
        service.store.add(work, work.id);
      });
      const profile = () => service.browsers.forWork(work);
      const control = (action: "open" | "take" | "release" | "close") =>
        service.browsers.control(profile().id, {
          requestId: randomUUID(),
          profileRevision: profile().revision,
          action,
        });
      await control("open");
      expect(profile().state).toBe("ready");
      const signal = new AbortController().signal;
      await service.browsers.execute(
        work,
        "browser_navigate",
        { url: origin + "/set-a" },
        signal,
      );
      await service.browsers.execute(
        work,
        "browser_navigate",
        { url: origin },
        signal,
      );
      const snapshot = await service.browsers.snapshot(work);
      expect(snapshot.text).toContain("Profile A cookie");
      const other = {
        ...work,
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: randomUUID(),
      };
      service.store.transaction(() => {
        other.browserProfileId = service.browsers.bind(other, [origin]);
        service.store.add(other, other.id);
      });
      const otherProfile = service.browsers.forWork(other);
      await service.browsers.control(otherProfile.id, {
        requestId: randomUUID(),
        profileRevision: otherProfile.revision,
        action: "open",
      });
      await service.browsers.execute(
        other,
        "browser_navigate",
        { url: origin },
        signal,
      );
      const otherSnapshot = await service.browsers.snapshot(other);
      expect(otherSnapshot.text).toContain("No profile cookie");
      expect(() =>
        service.browsers.validate(other, "browser_navigate", {
          url: "file:///C:/Windows/win.ini",
        }),
      ).toThrow();
      expect(snapshot.text).toContain("Apply fixture");
      expect(
        service.browsers.readSnapshot(snapshot.snapshotId).image.length,
      ).toBeGreaterThan(100);
      const action = {
        snapshotId: snapshot.snapshotId,
        pageId: snapshot.pageId,
        navigationRevision: snapshot.navigationRevision,
        action: "click",
        role: "button",
        name: "Apply fixture",
      };
      expect(() =>
        service.browsers.validate(work, "browser_action", {
          ...action,
          name: "Not observed",
        }),
      ).toThrow("not present");
      await control("take");
      expect((await service.browsers.snapshot(other)).pageId).toBe(
        otherSnapshot.pageId,
      );
      await expect(
        service.browsers.execute(work, "browser_action", action, signal),
      ).rejects.toThrow();
      await expect(service.browsers.snapshot(work)).rejects.toThrow(
        "owner control",
      );
      await control("release");
      expect(
        service.browsers.readSnapshot(snapshot.snapshotId).snapshot.stale,
      ).toBe(true);
      expect(() =>
        service.browsers.validate(work, "browser_action", action),
      ).toThrow("fresh snapshot");
      const fresh = await service.browsers.snapshot(work);
      await service.browsers.execute(
        work,
        "browser_action",
        {
          ...action,
          snapshotId: fresh.snapshotId,
          pageId: fresh.pageId,
          navigationRevision: fresh.navigationRevision,
        },
        signal,
      );
      expect((await service.browsers.snapshot(work)).text).toContain(
        "Observed",
      );
      expect(() =>
        service.browsers.validate(work, "browser_navigate", {
          url: "https://unconfigured.invalid/",
        }),
      ).toThrow("outside");
      await control("close");
      expect(profile().state).toBe("closed");
      expect(observed).toHaveBeenCalledTimes(2);
    } finally {
      await service.close();
      observed.mockRestore();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      const target = resolve(root),
        rel = relative(resolve(tmpdir()), target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel))
        throw Error("Unsafe test cleanup");
      await rm(target, { recursive: true, force: true });
    }
  },
  30000,
);
