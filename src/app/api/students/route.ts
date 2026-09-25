import { NextResponse } from "next/server";
import { demoStudents } from "@/lib/seed";
import {
  getStudentsFromGoogleSheets,
  isGoogleSheetsConfigured,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

export async function GET() {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ students: demoStudents, mode: "demo" });
  }

  try {
    const students = await getStudentsFromGoogleSheets();
    return NextResponse.json({ students, mode: "google-sheets" });
  } catch (error) {
    console.error("Failed to load students from Google Sheets", error);
    return NextResponse.json(
      { error: "Unable to load students from Google Sheets." },
      { status: 500 },
    );
  }
}
