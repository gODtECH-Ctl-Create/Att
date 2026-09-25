import type { AttendanceRecord, StaffSession, Student, SyncResponse } from "@/lib/types";

function getEndpoint() {
  return process.env.NEXT_PUBLIC_APPS_SCRIPT_URL?.trim() ?? "";
}

export class AuthError extends Error {
  constructor(message = "Your staff session has expired. Please sign in again.") {
    super(message);
    this.name = "AuthError";
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export function isSheetsConfigured() {
  return Boolean(getEndpoint());
}

async function parseJson(response: Response) {
  if (!response.ok) throw new Error("The attendance service could not be reached.");
  return response.json() as Promise<Record<string, unknown>>;
}

export async function loginStaff(username: string, pin: string): Promise<StaffSession> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "login", username, pin }),
  });

  const payload = await parseJson(response) as {
    ok?: boolean;
    error?: string;
    session?: StaffSession;
  };

  if (!payload.ok || !payload.session) {
    throw new Error(payload.error || "Could not sign in.");
  }

  return payload.session;
}

export async function logoutStaff(token: string) {
  const endpoint = getEndpoint();
  if (!endpoint || !token) return;

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "logout", token }),
    });
  } catch {
    // Local sign-out still succeeds if the device is offline.
  }
}

export async function fetchStudentsFromSheets(token: string): Promise<Student[]> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const url = new URL(endpoint);
  url.searchParams.set("action", "students");
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await parseJson(response) as {
    ok?: boolean;
    error?: string;
    students?: Student[];
  };

  if (payload.error === "unauthorized") throw new AuthError();
  if (!payload.ok) throw new Error(payload.error || "Could not load students from Google Sheets");

  return payload.students ?? [];
}

export async function syncAttendanceToSheets(
  records: AttendanceRecord[],
  token: string,
): Promise<SyncResponse> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "syncAttendance", token, records }),
  });

  const payload = await parseJson(response) as {
    ok?: boolean;
    error?: string;
    syncedIds?: string[];
  };

  if (payload.error === "unauthorized") throw new AuthError();
  if (!payload.ok) throw new Error(payload.error || "Could not sync attendance to Google Sheets");

  return { syncedIds: payload.syncedIds ?? [] };
}
