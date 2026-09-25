"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import {
  fetchStudentsFromSheets,
  isSheetsConfigured,
  syncAttendanceToSheets,
} from "@/lib/sheets-client";
import { formatSchoolDate, formatSchoolTime, getSchoolDateKey } from "@/lib/time";
import type { AttendanceRecord, Student } from "@/lib/types";

function recordId(date: string, studentId: string) {
  return `${date}:${studentId}`;
}

export function AttendanceApp() {
  const today = useMemo(() => getSchoolDateKey(), []);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecord>>({});
  const [classFilter, setClassFilter] = useState("All classes");
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [dataMode, setDataMode] = useState<"google-sheets" | "offline" | "setup">("offline");

  const refreshLocalState = useCallback(async () => {
    const [cachedStudents, records] = await Promise.all([
      db.students.where("status").equals("Active").toArray(),
      db.attendance.where("date").equals(today).toArray(),
    ]);

    setStudents(cachedStudents);
    setAttendance(Object.fromEntries(records.map((record) => [record.studentId, record])));
    setPendingCount(await db.attendance.filter((record) => !record.synced).count());
  }, [today]);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || !isSheetsConfigured()) return;

    const pending = await db.attendance.filter((record) => !record.synced).toArray();
    if (!pending.length) return;

    try {
      const result = await syncAttendanceToSheets(pending);
      if (result.syncedIds.length) {
        await db.transaction("rw", db.attendance, async () => {
          for (const id of result.syncedIds) {
            await db.attendance.update(id, { synced: true });
          }
        });
      }

      setDataMode("google-sheets");
      await refreshLocalState();
    } catch {
      // Records remain queued in IndexedDB until the next successful sync.
    }
  }, [refreshLocalState]);

  const loadStudents = useCallback(async () => {
    if (!isSheetsConfigured()) {
      setDataMode("setup");
      await refreshLocalState();
      return;
    }

    try {
      const sheetStudents = await fetchStudentsFromSheets();
      await db.transaction("rw", db.students, async () => {
        await db.students.clear();
        await db.students.bulkPut(sheetStudents);
      });
      setDataMode("google-sheets");
    } catch {
      setDataMode("offline");
    }

    await refreshLocalState();
  }, [refreshLocalState]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void loadStudents().then(syncPending);

    const handleOnline = () => {
      setOnline(true);
      void loadStudents().then(syncPending);
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadStudents, syncPending]);

  async function updateAttendance(student: Student, action: "ARRIVE" | "LEAVE") {
    const id = recordId(today, student.id);
    const existing = await db.attendance.get(id);
    const timestamp = new Date().toISOString();

    const next: AttendanceRecord = {
      id,
      studentId: student.id,
      studentName: student.name,
      className: student.className,
      date: today,
      arrivalAt: action === "ARRIVE" ? existing?.arrivalAt || timestamp : existing?.arrivalAt,
      departureAt: action === "LEAVE" ? timestamp : existing?.departureAt,
      updatedAt: timestamp,
      synced: false,
    };

    await db.attendance.put(next);
    await refreshLocalState();
    void syncPending();
  }

  const classes = useMemo(
    () => ["All classes", ...Array.from(new Set(students.map((student) => student.className))).sort()],
    [students],
  );

  const visibleStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return students.filter((student) => {
      const matchesClass = classFilter === "All classes" || student.className === classFilter;
      const matchesQuery =
        !normalizedQuery ||
        student.name.toLowerCase().includes(normalizedQuery) ||
        student.id.toLowerCase().includes(normalizedQuery);
      return matchesClass && matchesQuery;
    });
  }, [students, classFilter, query]);

  const stats = useMemo(() => {
    const records = Object.values(attendance);
    const arrived = records.filter((record) => record.arrivalAt).length;
    const left = records.filter((record) => record.departureAt).length;
    return {
      total: students.length,
      arrived,
      left,
      inSchool: Math.max(arrived - left, 0),
    };
  }, [attendance, students.length]);

  const sourceLabel =
    dataMode === "google-sheets"
      ? "Google Sheets connected"
      : dataMode === "setup"
        ? "Sheets setup required"
        : "Using offline cache";

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">School attendance</p>
          <h1>Today&apos;s check-in</h1>
          <p className="date">{formatSchoolDate(today)}</p>
        </div>
        <div className="status-stack">
          <span className={`pill ${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"}
          </span>
          <span className="pill neutral">{sourceLabel}</span>
        </div>
      </section>

      <section className="stats" aria-label="Attendance summary">
        <article><strong>{stats.total}</strong><span>Students</span></article>
        <article><strong>{stats.arrived}</strong><span>Arrived</span></article>
        <article><strong>{stats.inSchool}</strong><span>In school</span></article>
        <article><strong>{stats.left}</strong><span>Left</span></article>
      </section>

      {dataMode === "setup" && students.length === 0 && (
        <div className="sync-banner">
          <strong>Google Sheets is not connected yet.</strong>
          <span> Add the Apps Script deployment URL as the repository variable NEXT_PUBLIC_APPS_SCRIPT_URL.</span>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="sync-banner">
          <strong>{pendingCount} record{pendingCount === 1 ? "" : "s"} waiting to sync.</strong>
          <span>{online ? " Sync will retry automatically." : " They are saved safely on this device."}</span>
        </div>
      )}

      <section className="controls">
        <label>
          <span>Class</span>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
            {classes.map((className) => <option key={className}>{className}</option>)}
          </select>
        </label>
        <label className="search">
          <span>Search student</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or student ID"
          />
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
                <div className="avatar" aria-hidden="true">
                  {student.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}
                </div>
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
                {!hasArrived && (
                  <button className="primary" onClick={() => updateAttendance(student, "ARRIVE")}>Arrived</button>
                )}
                {hasArrived && !hasLeft && (
                  <button className="secondary" onClick={() => updateAttendance(student, "LEAVE")}>Mark left</button>
                )}
                {hasArrived && hasLeft && <span className="complete">Complete</span>}
              </div>
            </article>
          );
        })}

        {visibleStudents.length === 0 && dataMode !== "setup" && (
          <div className="empty">No students match this filter.</div>
        )}
      </section>
    </main>
  );
}
