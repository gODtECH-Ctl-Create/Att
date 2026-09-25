import type { AttendanceRecord, Student, SyncResponse } from "@/lib/types";

function getEndpoint() {
  return process.env.NEXT_PUBLIC_APPS_SCRIPT_URL?.trim() ?? "";
}

export function isSheetsConfigured() {
  return Boolean(getEndpoint());
}

export async function fetchStudentsFromSheets(): Promise<Student[]> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  const url = new URL(endpoint);
  url.searchParams.set("action", "students");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load students from Google Sheets");

  const payload = (await response.json()) as { students?: Student[] };
  return payload.students ?? [];
}

export async function syncAttendanceToSheets(
  records: AttendanceRecord[],
): Promise<SyncResponse> {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error("Google Apps Script URL is not configured");

  // text/plain keeps this as a simple cross-origin request and avoids exposing
  // any Google service-account credentials in the static GitHub Pages app.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "syncAttendance", records }),
  });

  if (!response.ok) throw new Error("Could not sync attendance to Google Sheets");

  const payload = (await response.json()) as SyncResponse;
  return {
    syncedIds: payload.syncedIds ?? [],
  };
}
