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

function normalizeStudent(student: Student): Student {
  return {
    ...student,
    id: String(student.id || "").trim(),
    name: String(student.name || "").trim(),
    className: String(student.className || "").trim(),
    status:
      String(student.status || "Active").trim().toLowerCase() === "inactive"
        ? "Inactive"
        : "Active",
  };
}

export type RegistrationResult = {
  username: string;
  name: string;
  registrationToken: string;
};

export type ApprovalResult = {
  status: "pending" | "approved" | "rejected" | "expired" | "invalid";
  session?: StaffSession;
  message?: string;
};

export type StaffDirectoryEntry = {
  username: string;
  name: string;
  role: string;
  status: string;
  mustChangePin: boolean;
};

async function postJson<T>(body: Record<string, unknown>): Promise<T> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });

  return parseJson(response) as Promise<T>;
}

export async function registerStaff(
  username: string,
  name: string,
  password: string,
): Promise<RegistrationResult> {
  const payload = await postJson<{
    ok?: boolean;
    error?: string;
    status?: string;
    registrationToken?: string;
    username?: string;
    name?: string;
  }>({ action: "registerStaff", username, name, password });

  if (!payload.ok || payload.status !== "pending" || !payload.registrationToken) {
    throw new Error(payload.error || "Could not create your account.");
  }

  return {
    username: String(payload.username || username),
    name: String(payload.name || name),
    registrationToken: payload.registrationToken,
  };
}

export async function checkRegistrationApproval(
  registrationToken: string,
): Promise<ApprovalResult> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const url = new URL(endpoint);
  url.searchParams.set("action", "approvalStatus");
  url.searchParams.set("registrationToken", registrationToken);

  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await parseJson(response) as {
    ok?: boolean;
    status?: ApprovalResult["status"];
    message?: string;
    session?: StaffSession;
  };

  return {
    status: payload.status || "invalid",
    message: payload.message,
    session: payload.session,
  };
}

export async function fetchStaffDirectory(token: string): Promise<StaffDirectoryEntry[]> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const url = new URL(endpoint);
  url.searchParams.set("action", "staff");
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await parseJson(response) as {
    ok?: boolean;
    error?: string;
    staff?: StaffDirectoryEntry[];
  };

  if (payload.error === "unauthorized") throw new AuthError();
  if (payload.error === "forbidden") throw new Error("Admin access is required.");
  if (!payload.ok) throw new Error(payload.error || "Could not load staff accounts.");

  return payload.staff ?? [];
}

export async function updateStaffApproval(
  token: string,
  action: "approveStaff" | "rejectStaff",
  username: string,
) {
  const payload = await postJson<{ ok?: boolean; error?: string; status?: string }>({
    action,
    token,
    username,
  });

  if (!payload.ok) throw new Error(payload.error || "Could not update staff request.");
}

export async function updateStaffStatus(
  token: string,
  username: string,
  status: "Active" | "Inactive",
) {
  const payload = await postJson<{ ok?: boolean; error?: string }>({
    action: "setStaffStatus",
    token,
    username,
    status,
  });

  if (!payload.ok) throw new Error(payload.error || "Could not update staff status.");
}

export async function changeOwnPassword(
  token: string,
  currentPassword: string,
  newPassword: string,
) {
  const payload = await postJson<{ ok?: boolean; error?: string }>({
    action: "changePassword",
    token,
    currentPassword,
    newPassword,
  });

  if (payload.error === "unauthorized") throw new AuthError();
  if (!payload.ok) throw new Error(payload.error || "Could not change password.");
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

  return (payload.students ?? [])
    .map(normalizeStudent)
    .filter((student) => student.id && student.status === "Active");
}

export async function fetchAttendanceFromSheets(
  date: string,
  token: string,
): Promise<AttendanceRecord[]> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const url = new URL(endpoint);
  url.searchParams.set("action", "attendance");
  url.searchParams.set("date", date);
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await parseJson(response) as {
    ok?: boolean;
    error?: string;
    attendance?: AttendanceRecord[];
  };

  if (payload.error === "unauthorized") throw new AuthError();
  if (!payload.ok) throw new Error(payload.error || "Could not load attendance from Google Sheets");

  return (payload.attendance ?? []).map((record) => ({ ...record, synced: true }));
}

export async function fetchAttendanceVersionFromSheets(
  date: string,
  token: string,
): Promise<string> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const url = new URL(endpoint);
  url.searchParams.set("action", "attendanceVersion");
  url.searchParams.set("date", date);
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await parseJson(response) as {
    ok?: boolean;
    error?: string;
    version?: string | number;
  };

  if (payload.error === "unauthorized") throw new AuthError();
  if (!payload.ok) throw new Error(payload.error || "Could not check attendance updates");

  return String(payload.version ?? "0");
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
