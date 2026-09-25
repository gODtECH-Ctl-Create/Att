import { google } from "googleapis";
import type { AttendanceRecord, Student } from "./types";

const STUDENTS_RANGE = "Students!A2:D";
const ATTENDANCE_RANGE = "Attendance!A2:G";

function getConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!spreadsheetId || !clientEmail || !privateKey) return null;
  return { spreadsheetId, clientEmail, privateKey };
}

function getSheetsClient() {
  const config = getConfig();
  if (!config) return null;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: config.clientEmail,
      private_key: config.privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return {
    spreadsheetId: config.spreadsheetId,
    sheets: google.sheets({ version: "v4", auth }),
  };
}

export function isGoogleSheetsConfigured() {
  return Boolean(getConfig());
}

export async function getStudentsFromGoogleSheets(): Promise<Student[]> {
  const client = getSheetsClient();
  if (!client) return [];

  const response = await client.sheets.spreadsheets.values.get({
    spreadsheetId: client.spreadsheetId,
    range: STUDENTS_RANGE,
  });

  return (response.data.values || [])
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      id: String(row[0]).trim(),
      name: String(row[1]).trim(),
      className: String(row[2] || "Unassigned").trim(),
      status: String(row[3] || "Active").trim().toLowerCase() === "inactive"
        ? "Inactive"
        : "Active",
    }));
}

export async function upsertAttendanceInGoogleSheets(records: AttendanceRecord[]) {
  const client = getSheetsClient();
  if (!client) return [];

  const current = await client.sheets.spreadsheets.values.get({
    spreadsheetId: client.spreadsheetId,
    range: ATTENDANCE_RANGE,
  });

  const rows = current.data.values || [];
  const rowByKey = new Map<string, number>();

  rows.forEach((row, index) => {
    const date = String(row[0] || "").trim();
    const studentId = String(row[1] || "").trim();
    if (date && studentId) rowByKey.set(`${date}:${studentId}`, index + 2);
  });

  const syncedIds: string[] = [];

  for (const record of records) {
    const key = `${record.date}:${record.studentId}`;
    const values = [[
      record.date,
      record.studentId,
      record.studentName,
      record.className,
      record.arrivalAt || "",
      record.departureAt || "",
      record.updatedAt,
    ]];

    const existingRow = rowByKey.get(key);

    if (existingRow) {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: client.spreadsheetId,
        range: `Attendance!A${existingRow}:G${existingRow}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
    } else {
      const append = await client.sheets.spreadsheets.values.append({
        spreadsheetId: client.spreadsheetId,
        range: "Attendance!A:G",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      });

      const updatedRange = append.data.updates?.updatedRange;
      const match = updatedRange?.match(/A(\d+):G\d+/);
      if (match) rowByKey.set(key, Number(match[1]));
    }

    syncedIds.push(record.id);
  }

  return syncedIds;
}
