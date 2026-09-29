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

const STAFF_HEADERS = [
  "Username",
  "Name",
  "Password Hash",
  "Salt",
  "Role",
  "Status",
  "Must Change Password",
];

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || "health");

  if (action === "health") {
    return jsonResponse({ ok: true });
  }

  if (action === "students") {
    const session = getSession_(params.token || "");
    if (!session) return jsonResponse({ ok: false, error: "unauthorized" });
    return jsonResponse({
      ok: true,
      students: getStudents_(),
      staff: publicSession_(session),
    });
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

  if (action === "staff") {
    const session = getSession_(params.token || "");
    if (!session) return jsonResponse({ ok: false, error: "unauthorized" });
    if (!isAdminSession_(session)) return jsonResponse({ ok: false, error: "forbidden" });

    return jsonResponse({ ok: true, staff: getStaffDirectory_() });
  }

  if (action === "approvalStatus") {
    return jsonResponse(checkRegistrationApproval_(params.registrationToken || ""));
  }

  return jsonResponse({ ok: false, error: "Unknown action" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(body.action || "");

    if (action === "registerStaff") {
      return jsonResponse(registerStaff_(body.username, body.name, body.password));
    }

    if (action === "login") {
      return jsonResponse(loginStaff_(body.username, body.password || body.pin));
    }

    if (action === "approveStaff") {
      return jsonResponse(setPendingStaffStatus_(body, "Active"));
    }

    if (action === "rejectStaff") {
      return jsonResponse(setPendingStaffStatus_(body, "Rejected"));
    }

    if (action === "setStaffStatus") {
      return jsonResponse(setStaffStatus_(body));
    }

    if (action === "changePassword") {
      return jsonResponse(changeOwnPassword_(body));
    }

    if (action === "logout") {
      logoutStaff_(body.token);
      return jsonResponse({ ok: true });
    }

    if (action === "syncAttendance" && Array.isArray(body.records)) {
      const session = getSession_(body.token || "");
      if (!session) {
        return jsonResponse({ ok: false, error: "unauthorized", syncedIds: [] });
      }

      const syncedIds = syncAttendance_(body.records, session);
      return jsonResponse({ ok: true, syncedIds: syncedIds });
    }

    return jsonResponse({ ok: false, error: "Invalid request" });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
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
    "<script>window.open(" + JSON.stringify(url) + ', "_blank");google.script.host.close();</script>',
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
      return String(row[0]).trim() &&
        String(row[3] || "Active").trim().toLowerCase() !== "inactive";
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
      const updatedAt =
        toIsoString_(row[6]) ||
        departureAt ||
        arrivalAt ||
        (date + "T00:00:00.000Z");

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

function loginStaff_(username, password) {
  username = String(username || "").trim().toLowerCase();
  password = String(password || "");

  if (!username || !password) {
    return { ok: false, error: "Enter your username and password." };
  }

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

  const rows = sheet.getRange(
    2,
    1,
    sheet.getLastRow() - 1,
    Math.max(sheet.getLastColumn(), 7),
  ).getValues();

  const row = rows.find(function (item) {
    return String(item[0] || "").trim().toLowerCase() === username;
  });

  if (!row) {
    cache.put(attemptKey, String(failures + 1), LOGIN_LOCK_SECONDS);
    return { ok: false, error: "Invalid username or password." };
  }

  const status = String(row[5] || "Active").trim().toLowerCase();

  if (status === "pending") {
    return { ok: false, error: "Your account is awaiting admin approval.", status: "pending" };
  }

  if (status === "rejected") {
    return { ok: false, error: "Your registration was not approved.", status: "rejected" };
  }

  if (status !== "active") {
    return { ok: false, error: "This staff account is inactive.", status: "inactive" };
  }

  const valid = hashPin_(password, String(row[3] || "")) === String(row[2] || "");

  if (!valid) {
    cache.put(attemptKey, String(failures + 1), LOGIN_LOCK_SECONDS);
    return { ok: false, error: "Invalid username or password." };
  }

  cache.remove(attemptKey);

  return {
    ok: true,
    session: createSessionForStaff_(row),
  };
}

function createSessionForStaff_(row) {
  const expiresAtMs = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const token = generateSecureToken_();

  const session = {
    token: token,
    username: String(row[0] || "").trim().toLowerCase(),
    name: String(row[1] || row[0] || "Staff").trim(),
    role: String(row[4] || "Staff").trim(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    mustChangePin: String(row[6] || "").trim().toLowerCase() === "true",
  };

  PropertiesService.getScriptProperties().setProperty(
    SESSION_PREFIX + token,
    JSON.stringify(session),
  );

  return session;
}

function registerStaff_(username, name, password) {
  username = String(username || "").trim().toLowerCase();
  name = String(name || "").trim();
  password = String(password || "");

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return {
      ok: false,
      error: "Username must be 3-40 characters using letters, numbers, dot, underscore or hyphen.",
    };
  }

  if (!name) return { ok: false, error: "Full name is required." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET) || getOrCreateSheet_(spreadsheet, STAFF_SHEET);
  ensureHeaders_(sheet, STAFF_HEADERS);

  let existingRowNumber = null;
  let existingRow = null;

  if (sheet.getLastRow() > 1) {
    const rows = sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      Math.max(sheet.getLastColumn(), 7),
    ).getValues();

    for (let i = 0; i < rows.length; i += 1) {
      if (String(rows[i][0] || "").trim().toLowerCase() === username) {
        existingRowNumber = i + 2;
        existingRow = rows[i];
        break;
      }
    }
  }

  if (existingRow) {
    const currentStatus = String(existingRow[5] || "Active").trim().toLowerCase();
    if (currentStatus !== "rejected") {
      return {
        ok: false,
        error: currentStatus === "pending"
          ? "That username is already awaiting approval."
          : "That username is already in use.",
      };
    }
  }

  const salt = Utilities.getUuid().replace(/-/g, "");
  const registrationToken = generateSecureToken_();
  const rowValues = [
    username,
    name,
    hashPin_(password, salt),
    salt,
    "Staff",
    "Pending",
    "FALSE",
  ];

  if (existingRowNumber) {
    sheet.getRange(existingRowNumber, 1, 1, STAFF_HEADERS.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  deletePendingTokensForUsername_(username);

  PropertiesService.getScriptProperties().setProperty(
    PENDING_STAFF_PREFIX + registrationToken,
    JSON.stringify({
      username: username,
      createdAt: Date.now(),
    }),
  );

  return {
    ok: true,
    status: "pending",
    registrationToken: registrationToken,
    username: username,
    name: name,
  };
}

function checkRegistrationApproval_(registrationToken) {
  registrationToken = String(registrationToken || "").trim();
  if (!registrationToken) return { ok: false, status: "invalid" };

  const properties = PropertiesService.getScriptProperties();
  const key = PENDING_STAFF_PREFIX + registrationToken;
  const raw = properties.getProperty(key);

  if (!raw) return { ok: false, status: "expired" };

  let pending;
  try {
    pending = JSON.parse(raw);
  } catch (error) {
    properties.deleteProperty(key);
    return { ok: false, status: "expired" };
  }

  if (
    !pending.createdAt ||
    Date.now() - Number(pending.createdAt) > PENDING_STAFF_HOURS * 60 * 60 * 1000
  ) {
    properties.deleteProperty(key);
    return { ok: false, status: "expired" };
  }

  let target;
  try {
    target = findStaffRow_(pending.username);
  } catch (error) {
    properties.deleteProperty(key);
    return { ok: false, status: "invalid" };
  }

  const status = String(target.values[5] || "Pending").trim().toLowerCase();

  if (status === "pending") {
    return {
      ok: true,
      status: "pending",
      username: pending.username,
    };
  }

  if (status === "rejected") {
    deletePendingTokensForUsername_(pending.username);
    return {
      ok: true,
      status: "rejected",
      message: "Your registration was not approved.",
    };
  }

  if (status !== "active") {
    return {
      ok: true,
      status: "pending",
      username: pending.username,
    };
  }

  deletePendingTokensForUsername_(pending.username);

  return {
    ok: true,
    status: "approved",
    session: createSessionForStaff_(target.values),
  };
}

function getStaffDirectory_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(
    2,
    1,
    sheet.getLastRow() - 1,
    Math.max(sheet.getLastColumn(), 7),
  ).getValues();

  return rows
    .filter(function (row) {
      return String(row[0] || "").trim();
    })
    .map(function (row) {
      return {
        username: String(row[0] || "").trim().toLowerCase(),
        name: String(row[1] || "").trim(),
        role: String(row[4] || "Staff").trim(),
        status: String(row[5] || "Active").trim(),
        mustChangePin: String(row[6] || "").trim().toLowerCase() === "true",
      };
    });
}

function findStaffRow_(username) {
  username = String(username || "").trim().toLowerCase();

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(STAFF_SHEET);

  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error("No staff accounts have been configured yet.");
  }

  const rows = sheet.getRange(
    2,
    1,
    sheet.getLastRow() - 1,
    Math.max(sheet.getLastColumn(), 7),
  ).getValues();

  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0] || "").trim().toLowerCase() === username) {
      return {
        sheet: sheet,
        rowNumber: i + 2,
        values: rows[i],
      };
    }
  }

  throw new Error("Staff account not found.");
}

function setPendingStaffStatus_(body, nextStatus) {
  const session = getSession_(body.token || "");
  if (!session) return { ok: false, error: "unauthorized" };
  if (!isAdminSession_(session)) return { ok: false, error: "forbidden" };

  const username = String(body.username || "").trim().toLowerCase();
  if (!username) return { ok: false, error: "Staff username is required." };

  const target = findStaffRow_(username);
  const current = String(target.values[5] || "Pending").trim().toLowerCase();

  if (current !== "pending") {
    return { ok: false, error: "That registration is no longer pending." };
  }

  target.sheet.getRange(target.rowNumber, 6).setValue(nextStatus);
  return { ok: true, username: username, status: nextStatus };
}

function setStaffStatus_(body) {
  const session = getSession_(body.token || "");
  if (!session) return { ok: false, error: "unauthorized" };
  if (!isAdminSession_(session)) return { ok: false, error: "forbidden" };

  const username = String(body.username || "").trim().toLowerCase();
  const requested = String(body.status || "").trim().toLowerCase();
  const status = requested === "active" ? "Active" : "Inactive";

  if (!username) return { ok: false, error: "Staff username is required." };

  if (username === session.username && status === "Inactive") {
    return { ok: false, error: "You cannot disable your own admin account." };
  }

  const target = findStaffRow_(username);
  const targetRole = String(target.values[4] || "Staff").trim().toLowerCase();

  if (targetRole === "admin" && status === "Inactive" && countActiveAdmins_() <= 1) {
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
    return staff.role.toLowerCase() === "admin" &&
      staff.status.toLowerCase() !== "inactive";
  }).length;
}

function deletePendingTokensForUsername_(username) {
  username = String(username || "").trim().toLowerCase();

  const properties = PropertiesService.getScriptProperties();
  const values = properties.getProperties();

  Object.keys(values).forEach(function (key) {
    if (key.indexOf(PENDING_STAFF_PREFIX) !== 0) return;

    try {
      const pending = JSON.parse(values[key]);
      if (String(pending.username || "").trim().toLowerCase() === username) {
        properties.deleteProperty(key);
      }
    } catch (error) {
      properties.deleteProperty(key);
    }
  });
}

function revokeSessionsForUsername_(username) {
  username = String(username || "").trim().toLowerCase();

  const properties = PropertiesService.getScriptProperties();
  const values = properties.getProperties();

  Object.keys(values).forEach(function (key) {
    if (key.indexOf(SESSION_PREFIX) !== 0) return;

    try {
      const session = JSON.parse(values[key]);
      if (
        String(session.username || "").trim().toLowerCase() === username
      ) {
        properties.deleteProperty(key);
      }
    } catch (error) {}
  });
}

function changeOwnPassword_(body) {
  const session = getSession_(body.token || "");
  if (!session) return { ok: false, error: "unauthorized" };

  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");

  if (newPassword.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters." };
  }

  if (currentPassword === newPassword) {
    return { ok: false, error: "Your new password must be different." };
  }

  const target = findStaffRow_(session.username);
  const currentHash = hashPin_(currentPassword, String(target.values[3] || ""));

  if (currentHash !== String(target.values[2] || "")) {
    return { ok: false, error: "Current password is incorrect." };
  }

  const salt = Utilities.getUuid().replace(/-/g, "");
  target.sheet.getRange(target.rowNumber, 3).setValue(hashPin_(newPassword, salt));
  target.sheet.getRange(target.rowNumber, 4).setValue(salt);
  target.sheet.getRange(target.rowNumber, 7).setValue("FALSE");

  return { ok: true };
}

function isAdminSession_(session) {
  return String(session && session.role || "").trim().toLowerCase() === "admin";
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

function generateSecureToken_() {
  return Utilities.getUuid().replace(/-/g, "") +
    Utilities.getUuid().replace(/-/g, "");
}

function logoutStaff_(token) {
  token = String(token || "").trim();
  if (!token) return;
  PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
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

  if (
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value)
  ) {
    return Utilities.formatDate(value, SCHOOL_TIME_ZONE, "yyyy-MM-dd");
  }

  return String(value).trim();
}

function toIsoString_(value) {
  if (!value) return "";

  if (
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value)
  ) {
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
