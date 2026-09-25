const STUDENTS_SHEET = "Students";
const ATTENDANCE_SHEET = "Attendance";

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "students";

  if (action === "students") {
    return jsonResponse({ students: getStudents_() });
  }

  if (action === "health") {
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Unknown action" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (body.action !== "syncAttendance" || !Array.isArray(body.records)) {
      return jsonResponse({ error: "Invalid request", syncedIds: [] });
    }

    const syncedIds = syncAttendance_(body.records);
    return jsonResponse({ syncedIds: syncedIds });
  } catch (error) {
    return jsonResponse({ error: String(error), syncedIds: [] });
  }
}

function setupAttendanceWorkbook() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const students = getOrCreateSheet_(spreadsheet, STUDENTS_SHEET);
  if (students.getLastRow() === 0) {
    students.appendRow(["Student ID", "Name", "Class", "Status"]);
    students.setFrozenRows(1);
  }

  const attendance = getOrCreateSheet_(spreadsheet, ATTENDANCE_SHEET);
  if (attendance.getLastRow() === 0) {
    attendance.appendRow([
      "Date",
      "Student ID",
      "Student Name",
      "Class",
      "Arrival",
      "Departure",
      "Updated At",
    ]);
    attendance.setFrozenRows(1);
  }
}

function getStudents_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STUDENTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();

  return rows
    .filter(function (row) {
      return String(row[0]).trim() && String(row[3] || "Active").toLowerCase() !== "inactive";
    })
    .map(function (row) {
      return {
        id: String(row[0]).trim(),
        name: String(row[1]).trim(),
        className: String(row[2]).trim(),
        status: String(row[3] || "Active").trim(),
      };
    });
}

function syncAttendance_(records) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(ATTENDANCE_SHEET);

    if (!sheet) {
      setupAttendanceWorkbook();
      sheet = spreadsheet.getSheetByName(ATTENDANCE_SHEET);
    }

    const values = sheet.getDataRange().getValues();
    const rowByKey = {};

    for (let i = 1; i < values.length; i += 1) {
      const date = normalizeDate_(values[i][0]);
      const studentId = String(values[i][1] || "").trim();
      if (date && studentId) rowByKey[date + ":" + studentId] = i + 1;
    }

    const syncedIds = [];

    records.forEach(function (record) {
      if (!record || !record.id || !record.studentId || !record.date) return;

      const key = String(record.date) + ":" + String(record.studentId);
      const row = [
        String(record.date),
        String(record.studentId),
        String(record.studentName || ""),
        String(record.className || ""),
        record.arrivalAt ? new Date(record.arrivalAt) : "",
        record.departureAt ? new Date(record.departureAt) : "",
        record.updatedAt ? new Date(record.updatedAt) : new Date(),
      ];

      if (rowByKey[key]) {
        sheet.getRange(rowByKey[key], 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
        rowByKey[key] = sheet.getLastRow();
      }

      syncedIds.push(String(record.id));
    });

    return syncedIds;
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function normalizeDate_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value).trim();
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
