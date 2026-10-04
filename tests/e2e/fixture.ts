import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** A failed assertion must not leave its synthetic approvals occupying the next test's slot. */
export const test = base.extend<{ isolateWork: void }>({
  isolateWork: [
    async ({ request }, use) => {
      if (!process.env.ROCKY_E2E_ROOT?.endsWith(".rocky-e2e"))
        throw Error("Owned E2E root is required");
      const read = async () => {
        const response = await request.get("/api/v1/works");
        if (!response.ok()) throw Error("Cannot inspect E2E Work state");
        return (await response.json()).works as {
          id: string;
          runId: string;
          executionSessionId: string;
          revision: number;
          status: string;
        }[];
      };
      const before = new Set((await read()).map((work) => work.id));
      try {
        await use();
      } finally {
        const { token } = await (await request.get("/api/v1/session")).json();
        for (const work of await read()) {
          if (
            before.has(work.id) ||
            !["queued", "running", "waiting_approval"].includes(work.status)
          )
            continue;
          const response = await request.post(`/api/v1/works/${work.id}/stop`, {
            headers: { "x-rocky-session": token },
            data: {
              requestId: randomUUID(),
              expectedRevision: work.revision,
              runId: work.runId,
              executionSessionId: work.executionSessionId,
            },
          });
          if (!response.ok() && response.status() !== 409)
            throw Error(`E2E cleanup stop failed: ${response.status()}`);
        }
      }
    },
    { auto: true },
  ],
});
export { expect };
