import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ quiet: true });

export interface AppConfig {
  adminPassword: string;
  backupDirectory: string;
  cookieSecure: boolean;
  databasePath: string;
  host: string;
  logLevel: string;
  migrationsDirectory: string;
  port: number;
  publicOrigin: string;
  serveClient: boolean;
  trustProxy: false | string;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  return port;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("COOKIE_SECURE must be either true or false.");
}

export function readConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const adminPassword = overrides.adminPassword ?? process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 8) {
    throw new Error("ADMIN_PASSWORD must contain at least 8 characters.");
  }

  const configuredOrigin = (
    overrides.publicOrigin ??
    process.env.PUBLIC_ORIGIN ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const parsedOrigin = new URL(configuredOrigin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
    throw new Error("PUBLIC_ORIGIN must use http or https.");
  }
  const publicOrigin = parsedOrigin.origin;

  return {
    adminPassword,
    backupDirectory: resolve(
      overrides.backupDirectory ?? process.env.BACKUP_DIR ?? "./backups",
    ),
    cookieSecure:
      overrides.cookieSecure ?? parseBoolean(process.env.COOKIE_SECURE, true),
    databasePath:
      overrides.databasePath === ":memory:"
        ? ":memory:"
        : resolve(
            overrides.databasePath ??
              process.env.DATABASE_PATH ??
              "./data/live-voting.sqlite",
          ),
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    logLevel: overrides.logLevel ?? process.env.LOG_LEVEL ?? "info",
    migrationsDirectory: resolve(
      overrides.migrationsDirectory ?? "./migrations",
    ),
    port: overrides.port ?? parsePort(process.env.PORT),
    publicOrigin,
    serveClient: overrides.serveClient ?? process.env.NODE_ENV === "production",
    trustProxy:
      overrides.trustProxy ??
      (process.env.TRUST_PROXY?.trim() || false),
  };
}
