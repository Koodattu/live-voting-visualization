import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApplication } from "../src/server/app.js";
import { testConfig } from "./helpers.js";

describe("database backups", () => {
  it("starts with degraded health when the daily backup location is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "live-voting-backup-test-"));
    const blockedBackupPath = join(directory, "not-a-directory");
    await writeFile(blockedBackupPath, "blocked");
    const application = await buildApplication(
      await testConfig({
        backupDirectory: blockedBackupPath,
        databasePath: join(directory, "live-voting.sqlite"),
      }),
    );

    try {
      const health = await application.app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(health.statusCode).toBe(200);
      expect(health.json<{ status: string }>().status).toBe("degraded");
    } finally {
      await application.app.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
