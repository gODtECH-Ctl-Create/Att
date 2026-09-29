const STUDENTS_SHEET = "Students";
const ATTENDANCE_SHEET = "Attendance";
const STAFF_SHEET = "Staff";
const SCHOOL_TIME_ZONE = "Africa/Lagos";
const SESSION_PREFIX = "attendance_session_";
const SESSION_HOURS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 600;
const ATTENDANCE_VERSION_PREFIX = "attendance_version_";
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

    if (body.action === "login") {
      return jsonResponse(loginStaff_(body.username, body.pin));
    }

    if (body.action === "logout") {
      logoutStaff_(body.token);
      return jsonResponse({ ok: true });
    }

    if (body.action === "createStaff") {
      return jsonResponse(createStaffFromApp_(body));
    }

    if (body.action === "setStaffStatus") {
      return jsonResponse(setStaffStatusFromApp_(body));
    }

    if (body.action === "resetStaffPin") {
      return jsonResponse(resetStaffPinFromApp_(body));
    }

    if (body.action === "changePin") {
      return jsonResponse(changeOwnPin_(body));
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
    .createMenu("Attendance Admin")
    .addItem("Open attendance app", "openAttendanceApp_")
    .addToUi();
}

function openAttendanceApp_() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert("Deploy the Apps Script as a web app first.");
    return;
  }
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      '<script>window.open(' + JSON.stringify(url) + ', "_blank");google.script.host.close();</script>',
    ).setWidth(1).setHeight(1),
    "Opening Att",
  );
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
  ensureHeaders_(sheet, STAFF_HEADERS);

  if (sheet.getLastRow() > 1) {
    const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    if (existing.some(function (row) { return String(row[0]).trim().toLowerCase() === username; })) {
      throw new Error("That username already exists.");
    }
  }

  const salt = Utilities.getUuid().replace(/-/g, "");
  sheet.appendRow([username, name, hashPin_(pin, salt), salt, role, "Active", "TRUE"]);
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

  const columnCount = Math.max(sheet.getLastColumn(), 7);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, columnCount).getValues();
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
    mustChangePin: parseBoolean_(row[6]),
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

function isAdminSession_(session) {
  return String(session && session.role || "").trim().toLowerCase() === "admin";
}

function parseBoolean_(value) {
  if (typeof value === "boolean") return value;
  return ["true", "yes", "1"].includes(String(value || "").trim().toLowerCase());
}

function generateDefaultPin_() {
  const uuid = Utilities.getUuid().replace(/-/g, "");
  let pin = "";
  for (let i = 0; i < uuid.length && pin.length < 6; i += 1) {
    const code = uuid.charCodeAt(i);
    if (code >= 48 && code <= 57) pin += uuid.charAt(i);
  }
  while (pin.length < 6) {
    pin += String((uuid.charCodeAt(pin.length % uuid.length) + pin.length) % 10);
  }
  return pin.slice(0, 6);
}

function normalizeRole_(role) {
  return String(role || "Staff").trim().toLowerCase() === "admin" ? "Admin" : "Staff";
}

function getStaffDirectory_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const columnCount = Math.max(sheet.getLastColumn(), 7);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, columnCount).getValues();

  return rows
    .filter(function (row) { return String(row[0] || "").trim(); })
    .map(function (row) {
      return {
        username: String(row[0] || "").trim().toLowerCase(),
        name: String(row[1] || "").trim(),
        role: normalizeRole_(row[4]),
        status: String(row[5] || "Active").trim(),
        mustChangePin: parseBoolean_(row[6]),
      };
    });
}

function findStaffRow_(username) {
  username = String(username || "").trim().toLowerCase();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET);
  if (!sheet || sheet.getLastRow() < 2) throw new Error("No staff accounts have been configured yet.");

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 7)).getValues();
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0] || "").trim().toLowerCase() === username) {
      return { sheet: sheet, rowNumber: i + 2, values: rows[i] };
    }
  }

  throw new Error("Staff account not found.");
}

function createStaffFromApp_(body) {
  const session = getSession_(body.token || "");
  if (!session) return { ok: false, error: "unauthorized" };
  if (!isAdminSession_(session)) return { ok: false, error: "forbidden" };

  let username = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const role = normalizeRole_(body.role);
  const requestedPin = String(body.defaultPin || "").trim();
  const pin = requestedPin || generateDefaultPin_();

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return { ok: false, error: "Username must be 3-40 characters using letters, numbers, dot, underscore or hyphen." };
  }
  if (!name) return { ok: false, error: "Staff name is required." };
  if (pin.length < 6) return { ok: false, error: "PIN must be at least 6 characters." };

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET) || getOrCreateSheet_(spreadsheet, STAFF_SHEET);
  ensureHeaders_(sheet, STAFF_HEADERS);

  if (sheet.getLastRow() > 1) {
    const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    if (existing.some(function (row) { return String(row[0]).trim().toLowerCase() === username; })) {
      return { ok: false, error: "That username already exists." };
    }
  }

  const salt = Utilities.getUuid().replace(/-/g, "");
  sheet.appendRow([username, name, hashPin_(pin, salt), salt, role, "Active", "TRUE"]);
  return { ok: true, username: username, defaultPin: pin };
}

function setStaffStatusFromApp_(body) {
  const session = getSession_(body.token || "");
  if (!session) return { ok: false, error: "unauthorized" };
  if (!isAdminSession_(session)) return { ok: false, error: "forbidden" };

  const username = String(body.username || "").trim().toLowerCase();
  const status = String(body.status || "").trim().toLowerCase() === "active" ? "Active" : "Inactive";

  if (!username) return { ok: false, error: "Staff username is required." };
  if (username === session.username && status === "Inactive") {
    return { ok: false, error: "You cannot disable your own admin account." };
  }

  const target = findStaffRow_(username);
  const targetRole = normalizeRole_(target.values[4]);

  if (status === "Inactive" && targetRole === "Admin" && countActiveAdmins_() <= 1) {
    return { ok: false, error: "At least one active admin account must remain." };
  }

  target.sheet.getRange(target.rowNumber, 6).setValue(status);

  if (status === "Inactive") {
    revokeSessionsForUsername_(username);
  }

  return { ok: true, username: username, status: status };
}

function countActiveAdmins_() {
  return getStaffDirectory_().filter(function (staff) {
    return staff.role === "Admin" &&
      String(staff.status || "Active").trim().toLowerCase() !== "inactive";
  }).length;
}

function revokeSessionsForUsername_(username) {
  const properties = PropertiesService.getScriptProperties();
  const values = properties.getProperties();
  Object.keys(values).forEach(function (key) {
    if (key.indexOf(SESSION_PREFIX) !== 0) return;
    try {
      const session = JSON.parse(values[key]);
      if (String(session.username || "").trim().toLowerCase() === username) {
        properties.deleteProperty(key);
      }
    } catch (error) {}
  });
}

function resetStaffPinFromApp_(body) {
  const session = getSession_(body.token || "");
  if (!session) return { ok: false, error: "unauthorized" };
  if (!isAdminSession_(session)) return { ok: false, error: "forbidden" };

  const username = String(body.username || "").trim().toLowerCase();
  if (!username) return { ok: false, error: "Staff username is required." };

  const target = findStaffRow_(username);
  const pin = generateDefaultPin_();
  const salt = Utilities.getUuid().replace(/-/g, "");

  target.sheet.getRange(target.rowNumber, 3).setValue(hashPin_(pin, salt));
  target.sheet.getRange(target.rowNumber, 4).setValue(salt);
  target.sheet.getRange(target.rowNumber, 7).setValue("TRUE");
  revokeSessionsForUsername_(username);

  return { ok: true, username: username, defaultPin: pin };
}

function changeOwnPin_(body) {
  const session = getSession_(body.token || "");
  if (!session) return { ok: false, error: "unauthorized" };

  const currentPin = String(body.currentPin || "");
  const newPin = String(body.newPin || "");

  if (newPin.length < 6) return { ok: false, error: "New PIN must be at least 6 characters." };
  if (currentPin === newPin) return { ok: false, error: "Your new PIN must be different." };

  const target = findStaffRow_(session.username);
  const currentHash = hashPin_(currentPin, String(target.values[3] || ""));
  if (currentHash !== String(target.values[2] || "")) {
    return { ok: false, error: "Current PIN is incorrect." };
  }

  const salt = Utilities.getUuid().replace(/-/g, "");
  target.sheet.getRange(target.rowNumber, 3).setValue(hashPin_(newPin, salt));
  target.sheet.getRange(target.rowNumber, 4).setValue(salt);
  target.sheet.getRange(target.rowNumber, 7).setValue("FALSE");

  return { ok: true };
}

function publicSession_(session) {
  return {
    username: session.username,
    name: session.name,
    role: session.role,
    expiresAt: session.expiresAt,
    mustChangePin: Boolean(session.mustChangePin),
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
