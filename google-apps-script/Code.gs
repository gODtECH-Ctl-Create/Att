const STUDENTS_SHEET = "Students";
const ATTENDANCE_SHEET = "Attendance";
const STAFF_SHEET = "Staff";
const SCHOOL_TIME_ZONE = "Africa/Lagos";
const SESSION_PREFIX = "attendance_session_";
const SESSION_HOURS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 600;
const ATTENDANCE_VERSION_PREFIX = "attendance_version_";
const PENDING_STAFF_PREFIX = "pending_staff_";
const PENDING_STAFF_HOURS = 48;
const STAFF_HEADERS = ["Username", "Name", "PIN Hash", "Salt", "Role", "Status", "Must Change PIN"];

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || "health";

  if (action === "health") {
    return jsonResponse({ ok: true });
  }

  if (action === "students") {
    const session = getSession_(params.token || "");
    if (!session) return jsonResponse({ ok: false, error: "unauthorized" });
    return jsonResponse({ ok: true, students: getStudents_(), staff: publicSession_(session) });
  }

  if (action === "attendance") {
    const session = getSession_(params.token || "");
    if (!session) return jsonResponse({ ok: false, error: "unauthorized" });

    const date = String(params.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ ok: false, error: "A valid attendance date is required." });
    }

    return jsonResponse({
      ok: true,
      attendance: getAttendanceByDate_(date),
      version: getAttendanceVersion_(date),
      staff: publicSession_(session),
    });
  }

  if (action === "staff") {
    const session = getSession_(params.token || "");
    if (!session) return jsonResponse({ ok: false, error: "unauthorized" });
    if (!isAdminSession_(session)) return jsonResponse({ ok: false, error: "forbidden" });
    return jsonResponse({ ok: true, staff: getStaffDirectory_() });
  }

  if (action === "approvalStatus") {
    return jsonResponse(checkRegistrationApproval_(params.registrationToken || ""));
  }

  if (action === "attendanceVersion") {
    const session = getSession_(params.token || "");
    if (!session) return jsonResponse({ ok: false, error: "unauthorized" });

    const date = String(params.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ ok: false, error: "A valid attendance date is required." });
    }

    return jsonResponse({
      ok: true,
      version: getAttendanceVersion_(date),
    });
  }

  return jsonResponse({ ok: false, error: "Unknown action" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (body.action === "registerStaff") {
      return jsonResponse(registerStaff_(body.username, body.name, body.password));
    }

    if (body.action === "login") {
      return jsonResponse(loginStaff_(body.username, body.password || body.pin));
    }

    if (body.action === "approveStaff") {
      return jsonResponse(setPendingStaffStatus_(body, "Active"));
    }

    if (body.action === "rejectStaff") {
      return jsonResponse(setPendingStaffStatus_(body, "Rejected"));
    }

    if (body.action === "setStaffStatus") {
      return jsonResponse(setStaffStatus_(body));
    }

    if (body.action === "changePassword") {
      return jsonResponse(changeOwnPassword_(body));
    }

    if (body.action === "logout") {
      logoutStaff_(body.token);
      return jsonResponse({ ok: true });
    }

    if (body.action === "syncAttendance" && Array.isArray(body.records)) {
      const session = getSession_(body.token || "");
      if (!session) {
        return jsonResponse({ ok: false, error: "unauthorized", syncedIds: [] });
      }

      const syncedIds = syncAttendance_(body.records, session);
      return jsonResponse({ ok: true, syncedIds: syncedIds });
    }

    return jsonResponse({ ok: false, error: "Invalid request", syncedIds: [] });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error), syncedIds: [] });
  }
}

function setupAttendanceWorkbook() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  ensureHeaders_(getOrCreateSheet_(spreadsheet, STUDENTS_SHEET), [
    "Student ID",
    "Name",
    "Class",
    "Status",
  ]);

  ensureHeaders_(getOrCreateSheet_(spreadsheet, ATTENDANCE_SHEET), [
    "Date",
    "Student ID",
    "Student Name",
    "Class",
    "Arrival",
    "Departure",
    "Updated At",
    "Updated By",
  ]);

  ensureHeaders_(getOrCreateSheet_(spreadsheet, STAFF_SHEET), STAFF_HEADERS);
}

function onOpen() {
  addAdminMenu_();
}

function addAdminMenu_() {
  SpreadsheetApp.getUi()
    .createMenu("Attendance")
    .addItem("Open ATT", "openAttendanceApp_")
    .addToUi();
}

function openAttendanceApp_() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert("Deploy the Apps Script as a web app first.");
    return;
  }

  const html = HtmlService.createHtmlOutput(
    '<script>window.open(' + JSON.stringify(url) + ', "_blank");google.script.host.close();</script>',
  ).setWidth(1).setHeight(1);

  SpreadsheetApp.getUi().showModalDialog(html, "Opening ATT");
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

function getAttendanceByDate_(date) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();

  return rows
    .filter(function (row) {
      return normalizeDate_(row[0]) === date && String(row[1] || "").trim();
    })
    .map(function (row) {
      const studentId = String(row[1] || "").trim();
      const arrivalAt = toIsoString_(row[4]);
      const departureAt = toIsoString_(row[5]);
      const updatedAt = toIsoString_(row[6]) || departureAt || arrivalAt || (date + "T00:00:00.000Z");

      return {
        id: date + ":" + studentId,
        studentId: studentId,
        studentName: String(row[2] || "").trim(),
        className: String(row[3] || "").trim(),
        date: date,
        arrivalAt: arrivalAt || undefined,
        departureAt: departureAt || undefined,
        updatedAt: updatedAt,
        synced: true,
      };
    });
}

function syncAttendance_(records, session) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(ATTENDANCE_SHEET);

    if (!sheet) {
      setupAttendanceWorkbook();
      sheet = spreadsheet.getSheetByName(ATTENDANCE_SHEET);
    }

    ensureHeaders_(sheet, [
      "Date",
      "Student ID",
      "Student Name",
      "Class",
      "Arrival",
      "Departure",
      "Updated At",
      "Updated By",
    ]);

    const values = sheet.getDataRange().getValues();
    const rowByKey = {};

    for (let i = 1; i < values.length; i += 1) {
      const date = normalizeDate_(values[i][0]);
      const studentId = String(values[i][1] || "").trim();
      if (date && studentId) rowByKey[date + ":" + studentId] = i + 1;
    }

    const syncedIds = [];
    const changedDates = {};

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
        String(session.name || session.username || "Staff"),
      ];

      if (rowByKey[key]) {
        sheet.getRange(rowByKey[key], 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
        rowByKey[key] = sheet.getLastRow();
      }

      syncedIds.push(String(record.id));
      changedDates[String(record.date)] = true;
    });

    Object.keys(changedDates).forEach(function (date) {
      bumpAttendanceVersion_(date);
    });

    return syncedIds;
  } finally {
    lock.releaseLock();
  }
}

function getAttendanceVersion_(date) {
  const key = ATTENDANCE_VERSION_PREFIX + String(date || "").trim();
  return PropertiesService.getScriptProperties().getProperty(key) || "0";
}

function bumpAttendanceVersion_(date) {
  const key = ATTENDANCE_VERSION_PREFIX + String(date || "").trim();
  const properties = PropertiesService.getScriptProperties();
  const current = Number(properties.getProperty(key) || "0");
  const next = Math.max(current + 1, Date.now());
  properties.setProperty(key, String(next));
  return String(next);
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
}

function normalizeDate_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return Utilities.formatDate(value, SCHOOL_TIME_ZONE, "yyyy-MM-dd");
  }
  return String(value).trim();
}

function toIsoString_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
