import type { GuestCredentials } from "../shared/contracts.js";

function storageKey(joinName: string): string {
  return `live-voting:guest:${joinName.toLowerCase()}`;
}

export function readGuestCredentials(
  joinName: string,
): GuestCredentials | undefined {
  try {
    const raw = localStorage.getItem(storageKey(joinName));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<GuestCredentials>;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.guestId !== "string" ||
      typeof parsed.secret !== "string"
    ) {
      return undefined;
    }
    return parsed as GuestCredentials;
  } catch {
    return undefined;
  }
}

export function saveGuestCredentials(
  joinName: string,
  credentials: GuestCredentials,
): void {
  localStorage.setItem(storageKey(joinName), JSON.stringify(credentials));
}
