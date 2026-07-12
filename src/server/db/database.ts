import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { AppConfig } from "../config.js";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const BACKUP_CHECK_INTERVAL = 60 * 60 * 1_000;
const BACKUP_RETENTION_DAYS = 14;

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function createBackup(
  database: Database.Database,
  directory: string,
  prefix: "daily" | "pre-migration",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const destination = join(
    directory,
    `${prefix}-${timestampForFilename()}.sqlite`,
  );
  await database.backup(destination);
  return destination;
}

export async function pruneBackups(
  directory: string,
  now = Date.now(),
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const cutoff = now - BACKUP_RETENTION_DAYS * DAY_IN_MILLISECONDS;

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(daily|pre-migration)-.*\.sqlite$/.test(entry.name),
      )
      .map(async (entry) => {
        const path = join(directory, entry.name);
        if ((await stat(path)).mtimeMs < cutoff) {
          await unlink(path);
        }
      }),
  );
}

async function readMigrations(
  directory: string,
): Promise<Array<{ id: string; sql: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && /^\d+_.*\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    filenames.map(async (filename) => ({
      id: basename(filename, ".sql"),
      sql: await readFile(join(directory, filename), "utf8"),
    })),
  );
}

async function newestDailyBackupTime(directory: string): Promise<number | null> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const times = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^daily-.*\.sqlite$/.test(entry.name))
      .map(async (entry) => (await stat(join(directory, entry.name))).mtimeMs),
  );
  return times.length === 0 ? null : Math.max(...times);
}

export interface BackupStatus {
  healthy: boolean;
  lastSuccessAt: string | null;
}

export interface DatabaseHandle {
  database: Database.Database;
  backupStatus: BackupStatus;
  close: () => Promise<void>;
}

export async function openDatabase(
  config: AppConfig,
  onBackupError: (error: unknown) => void = () => undefined,
): Promise<DatabaseHandle> {
  const existingDatabase =
    config.databasePath !== ":memory:" &&
    existsSync(config.databasePath) &&
    statSync(config.databasePath).size > 0;

  if (config.databasePath !== ":memory:") {
    await mkdir(dirname(config.databasePath), { recursive: true });
  }

  const database = new Database(config.databasePath, { timeout: 5_000 });
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  if (config.databasePath !== ":memory:") {
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = NORMAL");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const migrations = await readMigrations(config.migrationsDirectory);
  const applied = new Set(
    (
      database
        .prepare("SELECT id FROM schema_migrations ORDER BY id")
        .all() as Array<{ id: string }>
    ).map((row) => row.id),
  );
  const pending = migrations.filter((migration) => !applied.has(migration.id));

  if (pending.length > 0 && existingDatabase) {
    await createBackup(database, config.backupDirectory, "pre-migration");
  }

  const applyMigration = database.transaction(
    (migration: { id: string; sql: string }) => {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        )
        .run(migration.id, new Date().toISOString());
    },
  );

  for (const migration of pending) {
    applyMigration(migration);
  }

  const backupStatus: BackupStatus = {
    healthy: true,
    lastSuccessAt: null,
  };
  let closing = false;
  let backupInProgress: Promise<void> | null = null;

  const runDailyBackupIfDue = async (): Promise<void> => {
    if (closing || config.databasePath === ":memory:") return;
    if (backupInProgress) return backupInProgress;

    backupInProgress = (async () => {
      try {
        try {
          const latest = await newestDailyBackupTime(config.backupDirectory);
          if (latest !== null && Date.now() - latest < DAY_IN_MILLISECONDS) {
            backupStatus.healthy = true;
            backupStatus.lastSuccessAt = new Date(latest).toISOString();
          } else {
            await createBackup(database, config.backupDirectory, "daily");
            backupStatus.healthy = true;
            backupStatus.lastSuccessAt = new Date().toISOString();
          }
        } catch (error: unknown) {
          backupStatus.healthy = false;
          onBackupError(error);
          return;
        }
        try {
          await pruneBackups(config.backupDirectory);
        } catch (error: unknown) {
          backupStatus.healthy = false;
          onBackupError(error);
        }
      } finally {
        backupInProgress = null;
      }
    })();
    return backupInProgress;
  };

  await runDailyBackupIfDue();
  const backupTimer =
    config.databasePath === ":memory:"
      ? undefined
      : setInterval(() => void runDailyBackupIfDue(), BACKUP_CHECK_INTERVAL);
  backupTimer?.unref();

  return {
    database,
    backupStatus,
    close: async () => {
      closing = true;
      if (backupTimer) clearInterval(backupTimer);
      if (backupInProgress) await backupInProgress;
      database.close();
    },
  };
}
