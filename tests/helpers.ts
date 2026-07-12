import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AppConfig } from "../src/server/config.js";

export async function testConfig(
  overrides: Partial<AppConfig> = {},
): Promise<AppConfig> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "live-voting-test-"));
  return {
    adminPassword: "correct-horse-battery-staple",
    backupDirectory: temporaryDirectory,
    cookieSecure: false,
    databasePath: ":memory:",
    host: "127.0.0.1",
    logLevel: "silent",
    migrationsDirectory: resolve("migrations"),
    port: 0,
    publicOrigin: "http://127.0.0.1",
    serveClient: false,
    trustProxy: false,
    ...overrides,
  };
}
