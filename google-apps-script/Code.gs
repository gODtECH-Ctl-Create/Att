const STUDENTS_SHEET = "Students";
const ATTENDANCE_SHEET = "Attendance";
const STAFF_SHEET = "Staff";
const SESSION_PREFIX = "attendance_session_";
const SESSION_HOURS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 600;

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "health";

  if (action === "health") {
    return jsonResponse({ ok: true });
  }

  if (action === "students") {
    const session = getSession_((e.parameter && e.parameter.token) || "");
    if (!session) return jsonResponse({ ok: false, error: "unauthorized" });
    return jsonResponse({ ok: true, students: getStudents_(), staff: publicSession_(session) });
  }

  return jsonResponse({ ok: false, error: "Unknown action" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (body.action === "login") {
      return jsonResponse(loginStaff_(body.username, body.pin));
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

  ensureHeaders_(getOrCreateSheet_(spreadsheet, STAFF_SHEET), [
    "Username",
    "Name",
    "PIN Hash",
    "Salt",
    "Role",
    "Status",
  ]);

  addAdminMenu_();
}

function onOpen() {
  addAdminMenu_();
}

function addAdminMenu_() {
  SpreadsheetApp.getUi()
    .createMenu("Attendance Admin")
    .addItem("Add staff account", "createStaffAccountFromPrompt")
    .addToUi();
}

function createStaffAccountFromPrompt() {
  const ui = SpreadsheetApp.getUi();

  const usernameResult = ui.prompt("Add staff account", "Username", ui.ButtonSet.OK_CANCEL);
  if (usernameResult.getSelectedButton() !== ui.Button.OK) return;

  const nameResult = ui.prompt("Add staff account", "Staff name", ui.ButtonSet.OK_CANCEL);
  if (nameResult.getSelectedButton() !== ui.Button.OK) return;

  const pinResult = ui.prompt(
    "Add staff account",
    "Enter a PIN with at least 6 characters. It will be stored only as a salted hash.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (pinResult.getSelectedButton() !== ui.Button.OK) return;

  const roleResult = ui.prompt(
    "Add staff account",
    "Role: Admin or Staff",
    ui.ButtonSet.OK_CANCEL,
  );
  if (roleResult.getSelectedButton() !== ui.Button.OK) return;

  addStaffAccount_(
    usernameResult.getResponseText(),
    nameResult.getResponseText(),
    pinResult.getResponseText(),
    roleResult.getResponseText(),
  );

  ui.alert("Staff account created.");
}

function addStaffAccount_(username, name, pin, role) {
  username = String(username || "").trim().toLowerCase();
  name = String(name || "").trim();
  pin = String(pin || "");
  role = String(role || "Staff").trim();

  if (!username || !name) throw new Error("Username and name are required.");
  if (pin.length < 6) throw new Error("PIN must be at least 6 characters.");
  if (!["admin", "staff"].includes(role.toLowerCase())) role = "Staff";
  else role = role.toLowerCase() === "admin" ? "Admin" : "Staff";

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET) || getOrCreateSheet_(spreadsheet, STAFF_SHEET);
  ensureHeaders_(sheet, ["Username", "Name", "PIN Hash", "Salt", "Role", "Status"]);

  if (sheet.getLastRow() > 1) {
    const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    if (existing.some(function (row) { return String(row[0]).trim().toLowerCase() === username; })) {
      throw new Error("That username already exists.");
    }
  }

  const salt = Utilities.getUuid().replace(/-/g, "");
  sheet.appendRow([username, name, hashPin_(pin, salt), salt, role, "Active"]);
}

function loginStaff_(username, pin) {
  username = String(username || "").trim().toLowerCase();
  pin = String(pin || "");

  if (!username || !pin) return { ok: false, error: "Enter your username and PIN." };

  const cache = CacheService.getScriptCache();
  const attemptKey = "login_fail_" + username;
  const failures = Number(cache.get(attemptKey) || "0");
  if (failures >= MAX_LOGIN_ATTEMPTS) {
    return { ok: false, error: "Too many failed attempts. Try again in 10 minutes." };
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: false, error: "No staff accounts have been configured yet." };
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const row = rows.find(function (item) {
    return String(item[0]).trim().toLowerCase() === username;
  });

  const active = row && String(row[5] || "Active").trim().toLowerCase() !== "inactive";
  const valid = active && hashPin_(pin, String(row[3] || "")) === String(row[2] || "");

  if (!valid) {
    cache.put(attemptKey, String(failures + 1), LOGIN_LOCK_SECONDS);
    return { ok: false, error: "Invalid username or PIN." };
  }

  cache.remove(attemptKey);

  const expiresAtMs = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const token = (
    Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "")
  );
  const session = {
    token: token,
    username: username,
    name: String(row[1] || username),
    role: String(row[4] || "Staff"),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };

  PropertiesService.getScriptProperties().setProperty(
    SESSION_PREFIX + token,
    JSON.stringify(session),
  );

  return { ok: true, session: session };
}

function logoutStaff_(token) {
  token = String(token || "").trim();
  if (!token) return;
  PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
}

function getSession_(token) {
  token = String(token || "").trim();
  if (!token) return null;

  const properties = PropertiesService.getScriptProperties();
  const key = SESSION_PREFIX + token;
  const value = properties.getProperty(key);
  if (!value) return null;

  try {
    const session = JSON.parse(value);
    if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      properties.deleteProperty(key);
      return null;
    }
    return session;
  } catch (error) {
    properties.deleteProperty(key);
    return null;
  }
}

function publicSession_(session) {
  return {
    username: session.username,
    name: session.name,
    role: session.role,
    expiresAt: session.expiresAt,
  };
}

function hashPin_(pin, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ":" + String(pin),
    Utilities.Charset.UTF_8,
  );

  return bytes.map(function (byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
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
    });

    return syncedIds;
  } finally {
    lock.releaseLock();
  }
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
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value).trim();
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
