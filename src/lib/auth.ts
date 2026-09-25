import type { StaffSession } from "@/lib/types";

const STORAGE_KEY = "att-staff-session-v1";

export function getStoredStaffSession(): StaffSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as StaffSession;
    if (!session.token || !session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveStaffSession(session: StaffSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStaffSession() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}
