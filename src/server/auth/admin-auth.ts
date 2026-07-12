import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

const ADMIN_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const ADMIN_COOKIE_NAME = "live_voting_admin";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function fingerprintPassword(password: string): Buffer {
  return scryptSync(password, "live-voting-admin-session-v1", 32);
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const key = pair.slice(0, separator).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return null;
}

export class AdminAuth {
  private readonly passwordFingerprint: Buffer;
  private readonly passwordFingerprintHex: string;

  constructor(
    private readonly database: Database.Database,
    adminPassword: string,
  ) {
    this.passwordFingerprint = fingerprintPassword(adminPassword);
    this.passwordFingerprintHex = this.passwordFingerprint.toString("hex");
  }

  verifyPassword(candidate: string): boolean {
    const candidateFingerprint = fingerprintPassword(candidate);
    return timingSafeEqual(candidateFingerprint, this.passwordFingerprint);
  }

  createSession(): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + ADMIN_SESSION_LIFETIME_MS,
    ).toISOString();

    this.database
      .prepare(
        `INSERT INTO admin_sessions
          (token_hash, password_fingerprint, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        hashToken(token),
        this.passwordFingerprintHex,
        createdAt.toISOString(),
        expiresAt,
      );
    return { token, expiresAt };
  }

  isAuthenticated(token: string | null | undefined): boolean {
    if (!token) return false;
    const now = new Date().toISOString();
    this.database
      .prepare("DELETE FROM admin_sessions WHERE expires_at <= ?")
      .run(now);
    const row = this.database
      .prepare(
        `SELECT password_fingerprint, expires_at
         FROM admin_sessions
         WHERE token_hash = ?`,
      )
      .get(hashToken(token)) as
      | { password_fingerprint: string; expires_at: string }
      | undefined;

    return (
      row !== undefined &&
      row.expires_at > now &&
      row.password_fingerprint === this.passwordFingerprintHex
    );
  }

  invalidate(token: string | null | undefined): void {
    if (!token) return;
    this.database
      .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }
}
