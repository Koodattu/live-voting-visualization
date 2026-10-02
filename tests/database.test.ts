import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildApplication } from "../src/server/app.js";
import { openDatabase } from "../src/server/db/database.js";
import { VotingService } from "../src/server/services/voting-service.js";
import { testConfig } from "./helpers.js";

describe("database backups", () => {
  it("migrates existing sessions with locking enabled while preserving responses and making a backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "live-voting-migration-test-"));
    const config = await testConfig({
      databasePath: join(directory, "live-voting.sqlite"),
      backupDirectory: join(directory, "backups"),
    });
    const database = new Database(config.databasePath);
    try {
      database.exec(await readFile(join(config.migrationsDirectory, "001_initial.sql"), "utf8"));
      database.exec(`
        CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO schema_migrations VALUES ('001_initial', '2026-01-01T00:00:00Z');
        INSERT INTO sessions (id, join_name, title, language, status, presented_position,
          furthest_presented_position, started_at, created_at, updated_at)
        VALUES ('existing', 'existing', 'Existing session', 'en', 'live', 0, 0,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO questions (id, session_id, position, type, prompt, status, opened_at)
        VALUES ('question', 'existing', 0, 'single_choice', 'Choose', 'open', '2026-01-01T00:00:00Z');
        INSERT INTO options VALUES ('option-a', 'question', 0, 'A'), ('option-b', 'question', 1, 'B');
        INSERT INTO guest_identities VALUES ('guest', 'existing', 'unused-test-hash', '2026-01-01T00:00:00Z');
        INSERT INTO votes VALUES ('existing', 'question', 'guest', 'option-a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      `);
    } finally {
      database.close();
    }
    const handle = await openDatabase(config);
    try {
      const service = new VotingService(handle.database);
      const session = service.adminSnapshot("existing");
      expect(session.lockQuestions).toBe(true);
      expect(session.aiRecapEnabled).toBe(false);
      expect(session.recapVisible).toBe(false);
      expect(session.recap).toEqual({ status: "idle", content: null });
      expect(session.questions[0]?.status).toBe("open");
      expect(session.questions[0]?.result?.responseCount).toBe(1);
      expect(service.participantSnapshot("existing", "guest").ownResponse?.optionId).toBe("option-a");
      expect((await readdir(config.backupDirectory)).some((name) => name.startsWith("pre-migration-"))).toBe(true);
      expect(handle.database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      await handle.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

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
