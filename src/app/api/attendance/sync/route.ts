import { NextRequest, NextResponse } from "next/server";
import {
  isGoogleSheetsConfigured,
  upsertAttendanceInGoogleSheets,
} from "@/lib/google-sheets";
import type { AttendanceRecord, SyncResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { records?: AttendanceRecord[] };
  const records = body.records || [];

  if (records.length === 0) {
    return NextResponse.json<SyncResponse>({
      syncedIds: [],
      mode: isGoogleSheetsConfigured() ? "google-sheets" : "local-only",
    });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json<SyncResponse>(
      {
        syncedIds: [],
        mode: "local-only",
        message: "Google Sheets is not configured yet. Records remain safely stored on this device.",
      },
      { status: 202 },
    );
  }

  try {
    const syncedIds = await upsertAttendanceInGoogleSheets(records);
    return NextResponse.json<SyncResponse>({ syncedIds, mode: "google-sheets" });
  } catch (error) {
    console.error("Attendance sync failed", error);
    return NextResponse.json(
      { error: "Attendance could not be synced." },
      { status: 500 },
    );
  }
}
