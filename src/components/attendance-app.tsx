"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearStaffSession, getStoredStaffSession, saveStaffSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  fetchAttendanceFromSheets,
  fetchAttendanceVersionFromSheets,
  fetchStudentsFromSheets,
  isAuthError,
  isSheetsConfigured,
  loginStaff,
  logoutStaff,
  syncAttendanceToSheets,
} from "@/lib/sheets-client";
import { formatSchoolDate, formatSchoolTime, getSchoolDateKey } from "@/lib/time";
import { useTheme } from "@/components/theme-toggle";
import type { AttendanceRecord, StaffSession, Student } from "@/lib/types";

const ALL_STUDENTS = "All students";

function recordId(date: string, studentId: string) {
  return `${date}:${studentId}`;
}

type LocalState = {
  students: Student[];
  attendance: Record<string, AttendanceRecord>;
  pendingCount: number;
};

export function AttendanceApp() {
  const initialDate = useMemo(() => getSchoolDateKey(), []);
  const currentDateRef = useRef(initialDate);
  const loadVersionRef = useRef(0);
  const attendanceVersionRef = useRef("0");
  const pollBusyRef = useRef(false);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecord>>({});
  const [classFilter, setClassFilter] = useState(ALL_STUDENTS);
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [dataMode, setDataMode] = useState<"google-sheets" | "offline" | "setup">("offline");
  const [session, setSession] = useState<StaffSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const { dark, toggleTheme } = useTheme();

  const isToday = selectedDate === currentDate;

  const readLocalState = useCallback(async (dateKey: string): Promise<LocalState> => {
    const [cachedStudents, records, pending] = await Promise.all([
      db.students.where("status").equals("Active").toArray(),
      db.attendance.where("date").equals(dateKey).toArray(),
      db.attendance.filter((record) => !record.synced).count(),
    ]);

    return {
      students: cachedStudents,
      attendance: Object.fromEntries(records.map((record) => [record.studentId, record])),
      pendingCount: pending,
    };
  }, []);

  const applyLocalState = useCallback((localState: LocalState) => {
    setStudents(localState.students);
    setAttendance(localState.attendance);
    setPendingCount(localState.pendingCount);
  }, []);

  const refreshLocalState = useCallback(async (dateKey: string) => {
    applyLocalState(await readLocalState(dateKey));
  }, [applyLocalState, readLocalState]);

  const cacheRemoteAttendance = useCallback(async (
    dateKey: string,
    remoteRecords: AttendanceRecord[],
  ) => {
    await db.transaction("rw", db.attendance, async () => {
      const existing = await db.attendance.where("date").equals(dateKey).toArray();
      const syncedIds = existing.filter((record) => record.synced).map((record) => record.id);

      if (syncedIds.length) {
        await db.attendance.bulkDelete(syncedIds);
      }

      if (remoteRecords.length) {
        await db.attendance.bulkPut(
          remoteRecords.map((record) => ({ ...record, synced: true })),
        );
      }
    });
  }, []);

  const endSession = useCallback(() => {
    clearStaffSession();
    setSession(null);
    setStudents([]);
    setAttendance({});
    setPendingCount(0);
    setClassFilter(ALL_STUDENTS);
    setQuery("");
    setLoginError("");
    setDataMode("offline");
  }, []);

  const syncPending = useCallback(async (activeSession: StaffSession) => {
    if (!navigator.onLine || !isSheetsConfigured()) return;

    const pending = await db.attendance.filter((record) => !record.synced).toArray();
    if (!pending.length) return;

    try {
      const result = await syncAttendanceToSheets(pending, activeSession.token);
      if (result.syncedIds.length) {
        const syncedIdSet = new Set(result.syncedIds);
        const syncedRecords = pending
          .filter((record) => syncedIdSet.has(record.id))
          .map((record) => ({ ...record, synced: true }));

        if (syncedRecords.length) {
          await db.transaction("rw", db.attendance, async () => {
            await db.attendance.bulkPut(syncedRecords);
          });
        }
      }

      setDataMode("google-sheets");
      await refreshLocalState(selectedDate);
    } catch (error) {
      if (isAuthError(error)) endSession();
    }
  }, [endSession, refreshLocalState, selectedDate]);

  const loadViewData = useCallback(async (
    activeSession: StaffSession,
    dateKey: string,
  ) => {
    const loadVersion = ++loadVersionRef.current;

    // Render the local cache first. The network should revalidate it, not block it.
    const localState = await readLocalState(dateKey);
    if (loadVersion !== loadVersionRef.current) return;
    applyLocalState(localState);

    if (!isSheetsConfigured()) {
      setDataMode("setup");
      return;
    }

    if (!navigator.onLine) {
      setDataMode("offline");
      return;
    }

    try {
      // These requests are independent, so fetch them together to save a round trip.
      const [sheetStudents, sheetAttendance, attendanceVersion] = await Promise.all([
        fetchStudentsFromSheets(activeSession.token),
        fetchAttendanceFromSheets(dateKey, activeSession.token),
        fetchAttendanceVersionFromSheets(dateKey, activeSession.token),
      ]);

      if (loadVersion !== loadVersionRef.current) return;

      await db.transaction("rw", db.students, db.attendance, async () => {
        await db.students.clear();
        if (sheetStudents.length) {
          await db.students.bulkPut(sheetStudents);
        }
      });

      await cacheRemoteAttendance(dateKey, sheetAttendance);

      if (loadVersion !== loadVersionRef.current) return;

      attendanceVersionRef.current = attendanceVersion;
      setDataMode("google-sheets");
      await refreshLocalState(dateKey);
    } catch (error) {
      if (isAuthError(error)) {
        endSession();
        return;
      }
      setDataMode("offline");
    }
  }, [applyLocalState, cacheRemoteAttendance, endSession, readLocalState, refreshLocalState]);

  useEffect(() => {
    setOnline(navigator.onLine);
    setSession(getStoredStaffSession());
    setAuthReady(true);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const checkSchoolDate = () => {
      const nextDate = getSchoolDateKey();
      const previousDate = currentDateRef.current;
      if (nextDate === previousDate) return;

      currentDateRef.current = nextDate;
      setCurrentDate(nextDate);
      setSelectedDate((activeDate) => activeDate === previousDate ? nextDate : activeDate);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkSchoolDate();
    };

    checkSchoolDate();
    const timer = window.setInterval(checkSchoolDate, 60_000);
    window.addEventListener("focus", checkSchoolDate);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkSchoolDate);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    setClassFilter(ALL_STUDENTS);
    setQuery("");
  }, [selectedDate]);

  useEffect(() => {
    if (!authReady || !session) return;
    void loadViewData(session, selectedDate).then(() => syncPending(session));
  }, [authReady, session, loadViewData, syncPending, online, selectedDate]);

  const pollAttendance = useCallback(async (activeSession: StaffSession, dateKey: string) => {
    if (
      pollBusyRef.current ||
      !navigator.onLine ||
      !isSheetsConfigured() ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    pollBusyRef.current = true;

    try {
      const nextVersion = await fetchAttendanceVersionFromSheets(dateKey, activeSession.token);

      if (nextVersion === attendanceVersionRef.current) return;

      const records = await fetchAttendanceFromSheets(dateKey, activeSession.token);
      await cacheRemoteAttendance(dateKey, records);
      attendanceVersionRef.current = nextVersion;
      setDataMode("google-sheets");
      await refreshLocalState(dateKey);
    } catch (error) {
      if (isAuthError(error)) {
        endSession();
      }
    } finally {
      pollBusyRef.current = false;
    }
  }, [cacheRemoteAttendance, endSession, refreshLocalState]);

  useEffect(() => {
    attendanceVersionRef.current = "0";
    if (!session || !authReady) return;

    const run = () => void pollAttendance(session, selectedDate);
    run();

    const timer = window.setInterval(run, 2500);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") run();
    };

    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [authReady, pollAttendance, selectedDate, session]);

  useEffect(() => {
    if (!session) return;
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      endSession();
      return;
    }
    const timer = window.setTimeout(endSession, remaining);
    return () => window.clearTimeout(timer);
  }, [session, endSession]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navigator.onLine) {
      setLoginError("Connect to the internet to sign in.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const pin = String(form.get("pin") || "");

    setLoginBusy(true);
    setLoginError("");
    try {
      const nextSession = await loginStaff(username, pin);
      saveStaffSession(nextSession);
      setSession(nextSession);
      setSelectedDate(getSchoolDateKey());
      setClassFilter(ALL_STUDENTS);
      setQuery("");
      event.currentTarget.reset();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setLoginBusy(false);
    }
  }

  function handleLogout() {
    const token = session?.token;
    endSession();
    if (token && navigator.onLine) void logoutStaff(token);
  }

  async function updateAttendance(student: Student, action: "ARRIVE" | "LEAVE") {
    if (!session || !isToday) return;

    const id = recordId(currentDate, student.id);
    const existing = await db.attendance.get(id);
    const timestamp = new Date().toISOString();

    const next: AttendanceRecord = {
      id,
      studentId: student.id,
      studentName: student.name,
      className: student.className,
      date: currentDate,
      arrivalAt: action === "ARRIVE" ? existing?.arrivalAt || timestamp : existing?.arrivalAt,
      departureAt: action === "LEAVE" ? timestamp : existing?.departureAt,
      updatedAt: timestamp,
      synced: false,
    };

    await db.attendance.put(next);
    await refreshLocalState(selectedDate);
    void syncPending(session);
  }

  const viewStudents = useMemo(() => {
    if (isToday) return students;

    const byId = new Map(students.map((student) => [student.id, student]));
    for (const record of Object.values(attendance)) {
      if (!byId.has(record.studentId)) {
        byId.set(record.studentId, {
          id: record.studentId,
          name: record.studentName,
          className: record.className,
          status: "Active",
        });
      }
    }
    return Array.from(byId.values());
  }, [attendance, isToday, students]);

  const classes = useMemo(
    () => [ALL_STUDENTS, ...Array.from(new Set(viewStudents.map((student) => student.className))).sort()],
    [viewStudents],
  );

  useEffect(() => {
    if (classFilter !== ALL_STUDENTS && !classes.includes(classFilter)) {
      setClassFilter(ALL_STUDENTS);
    }
  }, [classes, classFilter]);

  const visibleStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return viewStudents.filter((student) => {
      const matchesClass = classFilter === ALL_STUDENTS || student.className === classFilter;
      const matchesQuery =
        !normalizedQuery ||
        student.name.toLowerCase().includes(normalizedQuery) ||
        student.id.toLowerCase().includes(normalizedQuery);
      return matchesClass && matchesQuery;
    });
  }, [viewStudents, classFilter, query]);

  const stats = useMemo(() => {
    const records = Object.values(attendance);
    const arrived = records.filter((record) => record.arrivalAt).length;
    const left = records.filter((record) => record.departureAt).length;
    return {
      total: viewStudents.length,
      arrived,
      left,
      inSchool: Math.max(arrived - left, 0),
    };
  }, [attendance, viewStudents.length]);

  if (!authReady) {
    return <main className="auth-shell"><div className="auth-card">Loading attendance…</div></main>;
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-topbar">
            <p className="eyebrow">School attendance</p>
            <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
              <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
              <span>{dark ? "Light" : "Dark"}</span>
            </button>
          </div>
          <h1>Staff sign in</h1>
          <p className="auth-copy">Sign in with the username and PIN created by the school administrator.</p>
          <span className={`pill ${online ? "online" : "offline"}`}>{online ? "Online" : "Offline"}</span>

          <form className="login-form" onSubmit={handleLogin}>
            <label>
              <span>Username</span>
              <input name="username" autoComplete="username" required placeholder="e.g. frontdesk" />
            </label>
            <label>
              <span>PIN</span>
              <input name="pin" type="password" inputMode="numeric" autoComplete="current-password" required minLength={6} placeholder="••••••" />
            </label>
            {loginError && <p className="auth-error">{loginError}</p>}
            <button className="login-button" disabled={loginBusy || !online}>
              {loginBusy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          {!online && <p className="auth-note">A first sign-in requires internet access.</p>}
        </section>
      </main>
    );
  }

  const sourceLabel = dataMode === "google-sheets"
    ? "Google Sheets connected"
    : dataMode === "setup"
      ? "Sheets setup required"
      : "Using offline cache";

  return (
    <main className="shell">
      <section className="staff-bar">
        <div><span>Signed in as</span><strong>{session.name}</strong><small>{session.role}</small></div>
        <div className="staff-actions">
          <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
            <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
            <span>{dark ? "Light" : "Dark"}</span>
          </button>
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </section>

      <section className="hero">
        <div>
          <p className="eyebrow">School attendance</p>
          <h1>{isToday ? "Today's check-in" : "Attendance history"}</h1>
          <p className="date">{formatSchoolDate(selectedDate)}</p>
        </div>
        <div className="status-stack">
          <span className={`pill ${online ? "online" : "offline"}`}>{online ? "Online" : "Offline"}</span>
          <span className="pill neutral">{sourceLabel}</span>
          {!isToday && <span className="pill history">Read-only history</span>}
        </div>
      </section>

      <section className="history-bar" aria-label="Attendance date">
        <label>
          <span>Attendance date</span>
          <input
            type="date"
            value={selectedDate}
            max={currentDate}
            onChange={(event) => setSelectedDate(event.target.value || currentDate)}
          />
        </label>
        {!isToday && <button onClick={() => setSelectedDate(currentDate)}>Back to today</button>}
      </section>

      <section className="stats" aria-label="Attendance summary">
        <article><strong>{stats.total}</strong><span>Students</span></article>
        <article><strong>{stats.arrived}</strong><span>Arrived</span></article>
        <article><strong>{stats.inSchool}</strong><span>{isToday ? "In school" : "No departure"}</span></article>
        <article><strong>{stats.left}</strong><span>Left</span></article>
      </section>

      {pendingCount > 0 && (
        <div className="sync-banner">
          <strong>{pendingCount} record{pendingCount === 1 ? "" : "s"} waiting to sync.</strong>
          <span>{online ? " Sync will retry automatically." : " They are saved safely on this device."}</span>
        </div>
      )}

      {!isToday && (
        <div className="history-banner">
          Viewing {formatSchoolDate(selectedDate)}. Historical attendance is read-only.
        </div>
      )}

      <section className="controls">
        <label>
          <span>Class filter</span>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
            {classes.map((className) => <option key={className}>{className}</option>)}
          </select>
        </label>
        <label className="search">
          <span>Search student</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or student ID" />
        </label>
      </section>

      <section className="student-list" aria-live="polite">
        {visibleStudents.map((student) => {
          const record = attendance[student.id];
          const hasArrived = Boolean(record?.arrivalAt);
          const hasLeft = Boolean(record?.departureAt);

          return (
            <article className="student-card" key={student.id}>
              <div className="student-main">
                <div className="avatar" aria-hidden="true">{student.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
                <div>
                  <h2>{student.name}</h2>
                  <p>{student.id} · {student.className}</p>
                  <div className="times">
                    <span>Arrived <strong>{formatSchoolTime(record?.arrivalAt)}</strong></span>
                    <span>Left <strong>{formatSchoolTime(record?.departureAt)}</strong></span>
                  </div>
                </div>
              </div>
              <div className="actions">
                {isToday && !hasArrived && <button className="primary" onClick={() => updateAttendance(student, "ARRIVE")}>Arrived</button>}
                {isToday && hasArrived && !hasLeft && <button className="secondary" onClick={() => updateAttendance(student, "LEAVE")}>Mark left</button>}
                {hasArrived && hasLeft && <span className="complete">Complete</span>}
                {!isToday && hasArrived && !hasLeft && <span className="history-status">Arrived only</span>}
                {!isToday && !hasArrived && <span className="history-status muted">Not marked</span>}
              </div>
            </article>
          );
        })}
        {visibleStudents.length === 0 && <div className="empty">No students match this filter.</div>}
      </section>
    </main>
  );
}
